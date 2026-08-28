-- Pivot to a feed-driven form guide: meetings and runners come from the Racing
-- NSW FreeFields feed instead of member input. Adds the feed key, race names,
-- runner form detail, a comments table, and the runner update policy the sync
-- needs (it runs with the member's own session, so RLS stays the boundary).

-- ─── meetings: remember which feed meeting this row mirrors ─────────────────
alter table public.meetings add column source_key text;
create unique index meetings_source_key_key on public.meetings (source_key) where source_key is not null;

-- ─── legs: carry the race name + jump time from the form guide ──────────────
alter table public.legs add column race_name text;
alter table public.legs add column race_time text;

-- ─── runners: the form guide itself (display only, never scored) ────────────
alter table public.runners add column jockey    text;
alter table public.runners add column trainer   text;
alter table public.runners add column barrier   text;
alter table public.runners add column weight    text;
alter table public.runners add column benchmark text;
alter table public.runners add column form      text;

-- The sync mirrors the feed through the member's own session. Runners only had
-- select+insert before (no update), which an upsert's conflict-update path
-- needs. Small trusted group: same trust model as meetings/legs.
create policy "runners_update_authenticated"
  on public.runners for update to authenticated
  using (true) with check (true);

-- ─── comments: the side panel ───────────────────────────────────────────────
create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

create index comments_meeting_id_idx on public.comments (meeting_id, created_at);

alter table public.comments enable row level security;

create policy "comments_select_authenticated"
  on public.comments for select to authenticated using (true);
create policy "comments_insert_own"
  on public.comments for insert to authenticated with check (user_id = auth.uid());
create policy "comments_delete_own"
  on public.comments for delete to authenticated using (user_id = auth.uid());

alter publication supabase_realtime add table public.comments;
