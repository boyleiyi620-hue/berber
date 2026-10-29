create table if not exists public.business_closures (
  closed_on date primary key,
  reason text not null default '',
  created_at timestamptz not null default now(),
  constraint business_closures_reason_length check (char_length(reason) <= 120)
);

alter table public.business_closures enable row level security;

grant select on public.business_closures to anon, authenticated;
grant insert, update, delete on public.business_closures to authenticated;

create policy "public read business closures"
  on public.business_closures for select
  to anon, authenticated
  using (true);

create policy "admins manage business closures"
  on public.business_closures for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.create_booking(
  p_client_name text,
  p_phone text,
  p_note text,
  p_service_id text,
  p_staff_id uuid,
  p_starts_at timestamp with time zone,
  p_timezone text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_service public.services%rowtype;
  v_settings public.business_settings%rowtype;
  v_local_start timestamp;
  v_appointment_id uuid;
begin
  if length(trim(coalesce(p_client_name, ''))) not between 1 and 80 then
    raise exception 'Lütfen geçerli bir ad girin.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_phone, ''))) not between 5 and 32 then
    raise exception 'Lütfen geçerli bir telefon girin.' using errcode = '22023';
  end if;
  if length(coalesce(p_note, '')) > 300 then
    raise exception 'Not 300 karakterden kısa olmalı.' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Geçersiz saat dilimi.' using errcode = '22023';
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
  if exists (
    select 1 from public.business_closures
    where closed_on = v_local_start::date
  ) then
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
$function$;
