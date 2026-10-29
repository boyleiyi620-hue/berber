-- Berber booking schema: customer data is private, public access is limited to
-- active catalog/staff, non-sensitive availability, and the booking RPC.
create table if not exists public.services (
  id text primary key,
  name text not null,
  description text not null default '',
  price numeric(10,2) not null check (price >= 0),
  duration_minutes integer not null check (duration_minutes between 15 and 240),
  icon text not null default '✂',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.business_settings (
  id smallint primary key default 1 check (id = 1),
  opening_time time not null default '09:00',
  closing_time time not null default '18:00',
  open_days smallint[] not null default array[1,2,3,4,5,6]::smallint[],
  updated_at timestamptz not null default now(),
  constraint valid_business_hours check (opening_time < closing_time),
  constraint valid_open_days check (open_days <@ array[1,2,3,4,5,6,7]::smallint[])
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_name text not null check (length(trim(client_name)) between 1 and 80),
  phone text not null check (length(trim(phone)) between 5 and 32),
  note text not null default '' check (length(note) <= 300),
  service_id text not null references public.services(id),
  staff_id uuid not null references public.staff(id),
  starts_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 15 and 240),
  price numeric(10,2) not null check (price >= 0),
  status text not null default 'booked' check (status in ('booked','completed','cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists appointments_staff_start_idx
  on public.appointments (staff_id, starts_at) where status = 'booked';
create index if not exists appointments_starts_at_idx on public.appointments (starts_at);

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

alter table public.services enable row level security;
alter table public.staff enable row level security;
alter table public.business_settings enable row level security;
alter table public.appointments enable row level security;

drop policy if exists "public read active services" on public.services;
create policy "public read active services" on public.services
  for select to anon, authenticated using (active or public.is_admin());
drop policy if exists "admins manage services" on public.services;
create policy "admins manage services" on public.services
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public read active staff" on public.staff;
create policy "public read active staff" on public.staff
  for select to anon, authenticated using (active or public.is_admin());
drop policy if exists "admins manage staff" on public.staff;
create policy "admins manage staff" on public.staff
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public read business settings" on public.business_settings;
create policy "public read business settings" on public.business_settings
  for select to anon, authenticated using (true);
drop policy if exists "admins manage business settings" on public.business_settings;
create policy "admins manage business settings" on public.business_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins manage appointments" on public.appointments;
create policy "admins manage appointments" on public.appointments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Grant only the operations used by the client. Public users cannot query customer data.
grant select on public.services, public.staff, public.business_settings to anon, authenticated;
grant insert, update, delete on public.services, public.staff, public.business_settings to authenticated;
grant select, update, delete on public.appointments to authenticated;
revoke all on public.appointments from anon;

create or replace function public.get_busy_slots(
  p_date date,
  p_staff_id uuid,
  p_timezone text
)
returns table(start_time time, duration_minutes integer)
language sql stable security definer
set search_path = ''
as $$
  select (a.starts_at at time zone p_timezone)::time, a.duration_minutes
  from public.appointments as a
  where a.staff_id = p_staff_id
    and a.status = 'booked'
    and (a.starts_at at time zone p_timezone)::date = p_date;
$$;

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

  -- Serialize bookings for this barber/day so overlapping requests cannot race.
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

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;
revoke all on function public.get_busy_slots(date, uuid, text) from public;
grant execute on function public.get_busy_slots(date, uuid, text) to anon, authenticated;
revoke all on function public.create_booking(text, text, text, text, uuid, timestamptz, text) from public;
grant execute on function public.create_booking(text, text, text, text, uuid, timestamptz, text) to anon, authenticated;

insert into public.services (id, name, description, price, duration_minutes, icon, active) values
  ('hair', 'Saç kesimi', '30 dakika · Klasik veya modern', 350, 30, '✂', true),
  ('beard', 'Sakal düzeltme', '30 dakika · Şekillendirme', 200, 30, '◒', true),
  ('combo', 'Saç + sakal', '60 dakika · Tam bakım', 500, 60, '✦', true)
on conflict (id) do update set name = excluded.name, description = excluded.description,
  price = excluded.price, duration_minutes = excluded.duration_minutes, icon = excluded.icon, active = excluded.active;

insert into public.staff (id, name, active) values
  ('00000000-0000-4000-8000-000000000001', 'Emre', true),
  ('00000000-0000-4000-8000-000000000002', 'Mert', true),
  ('00000000-0000-4000-8000-000000000003', 'Can', true)
on conflict (id) do update set name = excluded.name, active = excluded.active;

insert into public.business_settings (id, opening_time, closing_time, open_days)
values (1, '09:00', '18:00', array[1,2,3,4,5,6]::smallint[])
on conflict (id) do nothing;

notify pgrst, 'reload schema';
