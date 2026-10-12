-- Reel styles: which style template a reel was created from, and the subtitle file of each render.
alter table public.projects add column style_id text check (style_id is null or style_id ~ '^[a-z0-9-]{1,40}$');
alter table public.renders add column srt_path text;
