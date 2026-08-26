-- Quaddie Picks Tracker — initial schema + RLS (SPEC §5)
-- SP convention: winner_sp is TOTAL RETURN per $1 staked (incl. stake). Never stored odds-to-one.

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

create table public.meetings (
  id           uuid primary key default gen_random_uuid(),
  track        text not null,
  meeting_date date not null,
  status       text not null check (status in ('open','locked','settled')) default 'open',
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

create table public.legs (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references public.meetings(id) on delete cascade,
  leg_number   int  not null check (leg_number between 1 and 4),
  race_number  int,
  winner_number int,                    -- null until settled
  winner_name   text,
  winner_sp     numeric(7,2),           -- total return per $1; null until settled
  unique (meeting_id, leg_number)
);

create table public.picks (
  id            uuid primary key default gen_random_uuid(),
  leg_id        uuid not null references public.legs(id) on delete cascade,
  user_id       uuid not null references public.profiles(id),
  runner_number int  not null,
  runner_name   text,
  created_at    timestamptz not null default now(),
  unique (leg_id, user_id, runner_number)
);

create index legs_meeting_id_idx    on public.legs (meeting_id);
create index picks_leg_id_idx       on public.picks (leg_id);
create index picks_user_id_idx      on public.picks (user_id);
create index meetings_date_idx      on public.meetings (meeting_date desc);

-- ─── RLS ────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.meetings enable row level security;
alter table public.legs     enable row level security;
alter table public.picks    enable row level security;

-- profiles: read the group; write only your own row.
create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated using (true);
create policy "profiles_insert_self"
  on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_self"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- meetings + legs: small trusted group — any authenticated member may read/insert/update.
-- No delete policy exists, so no client can delete a meeting (SPEC §5).
create policy "meetings_select_authenticated"
  on public.meetings for select to authenticated using (true);
create policy "meetings_insert_authenticated"
  on public.meetings for insert to authenticated with check (true);
create policy "meetings_update_authenticated"
  on public.meetings for update to authenticated using (true) with check (true);

create policy "legs_select_authenticated"
  on public.legs for select to authenticated using (true);
create policy "legs_insert_authenticated"
  on public.legs for insert to authenticated with check (true);
create policy "legs_update_authenticated"
  on public.legs for update to authenticated using (true) with check (true);

-- picks: readable by the group; insert/delete only your own rows, and only while
-- the parent meeting is open. Status check lives HERE in the policy, not just UI.
create policy "picks_select_authenticated"
  on public.picks for select to authenticated using (true);

create policy "picks_insert_own_open_meeting"
  on public.picks for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.meetings m
      join public.legs l on l.meeting_id = m.id
      where l.id = leg_id
        and m.status = 'open'
    )
  );

create policy "picks_delete_own_open_meeting"
  on public.picks for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.meetings m
      join public.legs l on l.meeting_id = m.id
      where l.id = leg_id
        and m.status = 'open'
    )
  );

-- Realtime broadcast of new/changed picks (the live "who's picked what" feature).
alter publication supabase_realtime add table public.picks;
