insert into storage.buckets (id, name, public) values ('image_assets', 'image_assets', true) on conflict do nothing;
create policy "Public Access - image_assets" on storage.objects for select using ( bucket_id = 'image_assets' );
create policy "Auth Insert - image_assets" on storage.objects for insert with check ( bucket_id = 'image_assets' and auth.role() = 'authenticated' );
