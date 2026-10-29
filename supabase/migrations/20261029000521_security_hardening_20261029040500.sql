-- Reduce public attack surface while keeping customer booking and the admin UI functional.

create index if not exists appointments_service_id_idx
  on public.appointments (service_id);

create or replace function public.is_admin()
returns boolean
language sql stable security invoker
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

revoke all on function public.is_admin() from public;
revoke execute on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

-- This is a database event-trigger handler, not an application RPC. Remove
-- default API-role execute grants while retaining the owner's privilege.
revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role;

-- Catalog reads are public only for active rows; administrators can read all rows.
drop policy if exists "public read active services" on public.services;
create policy "public read active services" on public.services
  for select to anon using (active);
drop policy if exists "admins manage services" on public.services;
create policy "admins read all services" on public.services
  for select to authenticated using (public.is_admin());

-- Staff: customers see active staff; admins read all, add, and edit, but cannot delete.
drop policy if exists "public read active staff" on public.staff;
create policy "public read active staff" on public.staff
  for select to anon using (active);
drop policy if exists "admins manage staff" on public.staff;
create policy "admins read all staff" on public.staff
  for select to authenticated using (public.is_admin());
create policy "admins insert staff" on public.staff
  for insert to authenticated with check (public.is_admin());
create policy "admins update staff" on public.staff
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Replace broad admin policies with only the operations used by the UI.
drop policy if exists "admins manage appointments" on public.appointments;
create policy "admins read appointments" on public.appointments
  for select to authenticated using (public.is_admin());
create policy "admins update appointment status" on public.appointments
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

 drop policy if exists "admins manage business settings" on public.business_settings;
create policy "admins update business settings" on public.business_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins manage business closures" on public.business_closures;
create policy "admins insert business closures" on public.business_closures
  for insert to authenticated with check (public.is_admin());
create policy "admins delete business closures" on public.business_closures
  for delete to authenticated using (public.is_admin());

-- Grant only the table operations and columns exercised by the admin interface.
revoke insert, update, delete on public.services from authenticated;
revoke insert, update, delete on public.staff from authenticated;
grant insert (name, active), update (name, active) on public.staff to authenticated;
revoke insert, update, delete on public.business_settings from authenticated;
grant update (opening_time, closing_time, open_days, business_name, logo_url)
  on public.business_settings to authenticated;
revoke insert, update, delete on public.appointments from authenticated;
grant update (status) on public.appointments to authenticated;
revoke insert, update, delete on public.business_closures from authenticated;
grant insert (closed_on, reason), delete on public.business_closures to authenticated;

-- Only the anonymous customer client needs public availability and booking RPCs.
revoke all on function public.get_busy_slots(date, uuid, text) from public;
revoke execute on function public.get_busy_slots(date, uuid, text) from authenticated;
grant execute on function public.get_busy_slots(date, uuid, text) to anon;

create or replace function public.create_booking(
  p_client_name text,
  p_phone text,
  p_note text,
  p_service_id text,
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_timezone text
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_service public.services%rowtype;
  v_settings public.business_settings%rowtype;
  v_local_start timestamp;
  v_appointment_id uuid;
  v_phone_digits text;
  v_recent_count integer;
begin
  if length(trim(coalesce(p_client_name, ''))) not between 1 and 80 then
    raise exception 'Lütfen geçerli bir ad girin.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_phone, ''))) not between 5 and 32 then
    raise exception 'Lütfen geçerli bir telefon girin.' using errcode = '22023';
  end if;
  v_phone_digits := pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if length(v_phone_digits) not between 5 and 15 then
    raise exception 'Lütfen geçerli bir telefon numarası girin.' using errcode = '22023';
  end if;
  if length(coalesce(p_note, '')) > 300 then
    raise exception 'Not 300 karakterden kısa olmalı.' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Geçersiz saat dilimi.' using errcode = '22023';
  end if;

  -- Serialize requests for the same normalized phone before counting successful bookings.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('berber-booking-rate:' || v_phone_digits, 0)
  );
  select count(*) into v_recent_count
  from public.appointments as a
  where a.created_at > clock_timestamp() - interval '1 hour'
    and pg_catalog.regexp_replace(a.phone, '[^0-9]', '', 'g') = v_phone_digits;
  if v_recent_count >= 5 then
    raise exception 'Bu telefon numarasıyla bir saat içinde en fazla 5 randevu isteği oluşturulabilir.'
      using errcode = '22023';
  end if;

  select * into v_service from public.services where id = p_service_id and active;
  if not found then raise exception 'Bu hizmet artık alınamıyor.' using errcode = '22023'; end if;
  if not exists (select 1 from public.staff where id = p_staff_id and active) then
    raise exception 'Bu çalışan artık randevu kabul etmiyor.' using errcode = '22023';
  end if;
  select * into v_settings from public.business_settings where id = 1;
  if not found then raise exception 'İşletme ayarları henüz hazır değil.' using errcode = '22023'; end if;

  v_local_start := p_starts_at at time zone p_timezone;
  if v_local_start <= (clock_timestamp() at time zone p_timezone) then
    raise exception 'Geçmiş bir saate randevu alınamaz.' using errcode = '22023';
  end if;
  if exists (select 1 from public.business_closures where closed_on = v_local_start::date) then
    raise exception 'İşletme seçilen tarihte kapalı.' using errcode = '22023';
  end if;
  if extract(isodow from v_local_start)::smallint <> all(v_settings.open_days) then
    raise exception 'İşletme bu gün kapalı.' using errcode = '22023';
  end if;
  if v_local_start::time < v_settings.opening_time
     or v_local_start::time + make_interval(mins => v_service.duration_minutes) > v_settings.closing_time then
    raise exception 'Seçilen saat çalışma saatleri dışında.' using errcode = '22023';
  end if;
  if extract(minute from v_local_start) not in (0, 30) or extract(second from v_local_start) <> 0 then
    raise exception 'Randevular yarım saatlik aralıklarla alınır.' using errcode = '22023';
  end if;

  -- Preserve the existing overlap lock so concurrent requests cannot double-book a barber.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_staff_id::text || v_local_start::date::text, 0)
  );
  if exists (
    select 1 from public.appointments as a
    where a.staff_id = p_staff_id and a.status = 'booked'
      and a.starts_at < p_starts_at + make_interval(mins => v_service.duration_minutes)
      and a.starts_at + make_interval(mins => a.duration_minutes) > p_starts_at
  ) then
    raise exception 'Bu saat az önce doldu. Lütfen başka bir saat seçin.' using errcode = '23P01';
  end if;

  insert into public.appointments
    (client_name, phone, note, service_id, staff_id, starts_at, duration_minutes, price)
  values
    (trim(p_client_name), trim(p_phone), coalesce(trim(p_note), ''), v_service.id,
     p_staff_id, p_starts_at, v_service.duration_minutes, v_service.price)
  returning id into v_appointment_id;
  return v_appointment_id;
end;
$$;

revoke all on function public.create_booking(text, text, text, text, uuid, timestamptz, text) from public;
revoke execute on function public.create_booking(text, text, text, text, uuid, timestamptz, text) from authenticated;
grant execute on function public.create_booking(text, text, text, text, uuid, timestamptz, text) to anon;

notify pgrst, 'reload schema';
