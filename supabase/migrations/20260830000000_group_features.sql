-- Group features: unlock-for-late-scratchings, first/second picks, per-leg
-- comments, and a group chat board.

-- ─── unlock: remember who reopened a meeting and when ────────────────────────
alter table public.meetings add column reopened_by uuid references public.profiles(id);
alter table public.meetings add column reopened_at timestamptz;

-- ─── first/second pick ranking (display only, never scored) ──────────────────
alter table public.picks add column rank smallint check (rank in (1, 2));

-- Only one 1st and one 2nd per member per leg. Partial so unranked rows (null)
-- can be unlimited.
create unique index picks_rank_unique
  on public.picks (leg_id, user_id, rank)
  where rank is not null;

-- Ranking goes through this RPC, not a client UPDATE, for two reasons:
--   1. "setting a new one clears the old" must be atomic (two client updates
--      could otherwise violate the partial unique index);
--   2. picks has no UPDATE policy and should not grow a broad one — this
--      function touches only the rank column and only the caller's own pick.
create or replace function public.set_pick_rank(p_pick_id uuid, p_rank int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leg_id uuid;
  v_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_rank is not null and p_rank not in (1, 2) then
    raise exception 'rank must be 1, 2 or null';
  end if;

  select leg_id, user_id into v_leg_id, v_user_id
    from public.picks
   where id = p_pick_id;

  if v_leg_id is null then
    raise exception 'pick not found';
  end if;
  if v_user_id <> auth.uid() then
    raise exception 'not your pick';
  end if;

  if not exists (
    select 1
      from public.legs l
      join public.meetings m on m.id = l.meeting_id
     where l.id = v_leg_id
       and m.status = 'open'
  ) then
    raise exception 'picks can only be ranked while the meeting is open';
  end if;

  -- Setting a new 1st/2nd clears whichever pick currently holds that rank.
  if p_rank is not null then
    update public.picks
       set rank = null
     where leg_id = v_leg_id
       and user_id = auth.uid()
       and rank = p_rank
       and id <> p_pick_id;
  end if;

  update public.picks set rank = p_rank where id = p_pick_id;
end $$;

revoke all on function public.set_pick_rank(uuid, int) from public;
grant execute on function public.set_pick_rank(uuid, int) to authenticated;

-- ─── per-leg comments ────────────────────────────────────────────────────────
create table public.leg_comments (
  id         uuid primary key default gen_random_uuid(),
  leg_id     uuid not null references public.legs(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

create index leg_comments_leg_id_idx on public.leg_comments (leg_id, created_at);

alter table public.leg_comments enable row level security;

create policy "leg_comments_select_authenticated"
  on public.leg_comments for select to authenticated using (true);
create policy "leg_comments_insert_own"
  on public.leg_comments for insert to authenticated with check (user_id = auth.uid());
create policy "leg_comments_delete_own"
  on public.leg_comments for delete to authenticated using (user_id = auth.uid());

-- The screen subscribes filtered on leg_id, so a DELETE (whose WAL row carries
-- only the PK by default) would never reach the receiving channel. Same fix as
-- picks (D10).
alter table public.leg_comments replica identity full;

alter publication supabase_realtime add table public.leg_comments;

-- ─── group chat board ────────────────────────────────────────────────────────
create table public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  body         text not null,
  created_at   timestamptz not null default now(),
  is_anonymous boolean not null default false
);

create index chat_messages_created_at_idx on public.chat_messages (created_at);

alter table public.chat_messages enable row level security;

create policy "chat_messages_select_authenticated"
  on public.chat_messages for select to authenticated using (true);
create policy "chat_messages_insert_own"
  on public.chat_messages for insert to authenticated with check (user_id = auth.uid());
create policy "chat_messages_delete_own"
  on public.chat_messages for delete to authenticated using (user_id = auth.uid());

alter publication supabase_realtime add table public.chat_messages;

-- Anonymous messages never expose user_id to the client. user_id stays recorded
-- on the row (so RLS delete-own still works), but the API response omits it for
-- anonymous rows — the client reads this view, never the table, so the omission
-- is enforced at the API layer, not just hidden in the UI.
create view public.chat_messages_view as
select
  id,
  body,
  created_at,
  is_anonymous,
  case when is_anonymous then null else user_id end as user_id
from public.chat_messages;

grant select on public.chat_messages_view to authenticated;
grant select on public.chat_messages_view to anon;
