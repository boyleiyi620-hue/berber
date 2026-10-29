-- Keep the service id and creation timestamp immutable after insertion.
revoke insert, update on table public.services from authenticated;
grant insert (id, name, description, price, duration_minutes, icon, active)
  on table public.services to authenticated;
grant update (name, description, price, duration_minutes, icon, active)
  on table public.services to authenticated;
