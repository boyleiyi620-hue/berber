-- Service management is available only to authenticated administrators.
-- Customers retain read-only access to active services through the existing policy.
grant select, insert, update on table public.services to authenticated;
create policy "admins insert services" on public.services
  for insert to authenticated with check (public.is_admin());
create policy "admins update services" on public.services
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
