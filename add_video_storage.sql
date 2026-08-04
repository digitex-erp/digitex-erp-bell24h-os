insert into storage.buckets (id, name, public) values ('video_assets', 'video_assets', true) on conflict do nothing;
create policy "Public Access - video_assets" on storage.objects for select using ( bucket_id = 'video_assets' );
create policy "Auth Insert - video_assets" on storage.objects for insert with check ( bucket_id = 'video_assets' and auth.role() = 'authenticated' );
