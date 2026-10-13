-- Footage editor, plan 2: extra photos and clips uploaded with the video, and the team's Soul ID characters.

-- The owner of an 'uploading' footage project may also upload up to six extra files next to the source video.
drop policy "owners upload footage" on storage.objects;
drop policy "owners replace footage" on storage.objects;
create policy "owners upload footage" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'assets'
    and name ~ '^footage/[0-9a-f-]{36}/(source\.(mp4|mov)|extra-[1-6]\.(mp4|mov|jpg|jpeg|png|webp))$'
    and exists (
      select 1 from public.projects p
       where p.id::text = split_part(name, '/', 2)
         and p.owner_id = (select auth.uid())
         and p.status = 'uploading'));
create policy "owners replace footage" on storage.objects for update to authenticated
  using (
    bucket_id = 'assets'
    and name ~ '^footage/[0-9a-f-]{36}/(source\.(mp4|mov)|extra-[1-6]\.(mp4|mov|jpg|jpeg|png|webp))$'
    and exists (
      select 1 from public.projects p
       where p.id::text = split_part(name, '/', 2)
         and p.owner_id = (select auth.uid())
         and p.status = 'uploading'))
  with check (
    bucket_id = 'assets'
    and name ~ '^footage/[0-9a-f-]{36}/(source\.(mp4|mov)|extra-[1-6]\.(mp4|mov|jpg|jpeg|png|webp))$');

-- Soul ID characters, trained once with the higgsfield-soul-id flow; reference_id is Higgsfield's custom reference id.
create table public.soul_characters (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  reference_id text not null unique check (reference_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index soul_characters_created_by_idx on public.soul_characters (created_by);
alter table public.soul_characters enable row level security;
create policy "team reads characters" on public.soul_characters for select to authenticated using (true);
create policy "members add characters" on public.soul_characters for insert to authenticated
  with check (created_by = (select auth.uid()));
revoke update, delete on public.soul_characters from authenticated;
revoke all on public.soul_characters from anon;
