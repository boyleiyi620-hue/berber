alter table public.business_settings
  add column if not exists business_name text not null default 'Berber Studio'
    check (char_length(btrim(business_name)) between 1 and 80),
  add column if not exists logo_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'business-branding',
  'business-branding',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read business branding logos" on storage.objects;
create policy "Public can read business branding logos"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'business-branding');

drop policy if exists "Admins can upload business branding logos" on storage.objects;
create policy "Admins can upload business branding logos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'business-branding' and public.is_admin());

drop policy if exists "Admins can delete business branding logos" on storage.objects;
create policy "Admins can delete business branding logos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'business-branding' and public.is_admin());
