-- Feature-race exotics: an ordered trifecta and first 4 for one race on a
-- meeting (Melbourne Cup is the first). Separate from quaddie picks.
-- Picks stay open — race_time on legs is a display string, not a jump timestamp.
--
-- Apply on production (with the two still-unapplied October migrations if
-- those have not been run):
--   supabase/migrations/20261030000000_picks_open_until_settled.sql
--   supabase/migrations/20261030010000_anon_read.sql
--   supabase/migrations/20261102000000_exotic_picks.sql

create table public.exotic_picks (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references public.meetings(id) on delete cascade,
  race_number  int  not null check (race_number between 1 and 20),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  trifecta     smallint[] not null default '{}',
  first4       smallint[] not null default '{}',
  updated_at   timestamptz not null default now(),
  unique (meeting_id, race_number, user_id),
  constraint exotic_picks_trifecta_len check (cardinality(trifecta) in (0, 3)),
  constraint exotic_picks_first4_len check (cardinality(first4) in (0, 4))
);

create index exotic_picks_meeting_race_idx
  on public.exotic_picks (meeting_id, race_number);

alter table public.exotic_picks enable row level security;

grant select on public.exotic_picks to anon, authenticated;
grant insert, update, delete on public.exotic_picks to authenticated;

create policy "exotic_picks_select_authenticated"
  on public.exotic_picks for select to authenticated using (true);
create policy "exotic_picks_select_anon"
  on public.exotic_picks for select to anon using (true);
create policy "exotic_picks_insert_own"
  on public.exotic_picks for insert to authenticated
  with check (user_id = auth.uid());
create policy "exotic_picks_update_own"
  on public.exotic_picks for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "exotic_picks_delete_own"
  on public.exotic_picks for delete to authenticated
  using (user_id = auth.uid());

alter table public.exotic_picks replica identity full;
alter publication supabase_realtime add table public.exotic_picks;
