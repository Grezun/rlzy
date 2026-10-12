-- Footage editor, plan 1: the user's own video upload, three footage job types, JSON data assets and the team music library.

-- A footage reel waits in 'uploading' until the web app records the finished upload.
alter table public.projects drop constraint projects_status_check;
alter table public.projects add constraint projects_status_check
  check (status in ('uploading', 'planning', 'draft', 'generating', 'needs_attention', 'rendered', 'failed'));

alter table public.jobs drop constraint jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (type in ('plan', 'generate', 'ingest_footage', 'plan_footage', 'generate_footage'));

-- 'data' assets hold the transcript and face-track JSON.
alter table public.assets drop constraint assets_kind_check;
alter table public.assets add constraint assets_kind_check check (kind in ('image', 'video', 'audio', 'data'));

-- Team music library: tracks uploaded on the settings page, picked by mood.
create table public.team_music (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique check (storage_path ~ '^music/[0-9a-f-]{36}\.(mp3|wav|m4a|aac)$'),
  title text not null check (char_length(title) between 1 and 80),
  mood text not null check (mood in ('calm', 'upbeat', 'dramatic')),
  duration_sec numeric not null check (duration_sec > 0 and duration_sec <= 900),
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index team_music_created_by_idx on public.team_music (created_by);
alter table public.team_music enable row level security;
create policy "team reads music" on public.team_music for select to authenticated using (true);
create policy "members add music" on public.team_music for insert to authenticated
  with check (created_by = (select auth.uid()));
revoke update, delete on public.team_music from authenticated;
revoke all on public.team_music from anon;

-- Storage: the owner of an 'uploading' footage project may upload (and resume or replace) its source video.
create policy "owners upload footage" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'assets'
    and name ~ '^footage/[0-9a-f-]{36}/source\.(mp4|mov)$'
    and exists (
      select 1 from public.projects p
       where p.id::text = split_part(name, '/', 2)
         and p.owner_id = (select auth.uid())
         and p.status = 'uploading'));
create policy "owners replace footage" on storage.objects for update to authenticated
  using (
    bucket_id = 'assets'
    and name ~ '^footage/[0-9a-f-]{36}/source\.(mp4|mov)$'
    and exists (
      select 1 from public.projects p
       where p.id::text = split_part(name, '/', 2)
         and p.owner_id = (select auth.uid())
         and p.status = 'uploading'))
  with check (
    bucket_id = 'assets'
    and name ~ '^footage/[0-9a-f-]{36}/source\.(mp4|mov)$');
-- Signed-in members may add music tracks.
create policy "members upload music" on storage.objects for insert to authenticated
  with check (bucket_id = 'assets' and name ~ '^music/[0-9a-f-]{36}\.(mp3|wav|m4a|aac)$');
