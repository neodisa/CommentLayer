-- comment-layer schema. Run once in the Supabase SQL editor.
create table if not exists comments (
  -- Client-assigned globally-unique id (uuid string). Sequential ids collide
  -- across reviewers, so the SDK generates a uuid; the DB never assigns one.
  id             text primary key,
  project_id     text not null,
  author         text not null,
  text           text not null,
  status         text not null default 'open',
  fp             jsonb not null,
  html_snapshot  jsonb,
  meta           jsonb,
  born_v         int,
  resolved_v     int,
  resolve_reason text,
  ts             text,
  created_at     timestamptz default now()
);

create index if not exists comments_project_idx on comments(project_id);

-- Default policy: public read/write scoped by app via project_id.
-- NOTE: anon rw = anyone with the anon key can read/write. Fine for internal
-- review; tighten with auth before public use.
alter table comments enable row level security;
drop policy if exists "anon rw" on comments;
create policy "anon rw" on comments for all using (true) with check (true);

-- Realtime for live multi-reviewer updates.
alter publication supabase_realtime add table comments;
