-- Third pick: extend `picks.rank` from (1, 2) to (1, 2, 3) and teach the
-- set_pick_rank RPC to accept 3. The partial unique index picks_rank_unique is
-- unaffected — it keys on (leg_id, user_id, rank) for any non-null rank, so a
-- member can hold exactly one 3rd per leg just like 1st/2nd.

-- Inline `check (rank in (1, 2))` was auto-named picks_rank_check.
alter table public.picks drop constraint picks_rank_check;
alter table public.picks add constraint picks_rank_check check (rank in (1, 2, 3));

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

  if p_rank is not null and p_rank not in (1, 2, 3) then
    raise exception 'rank must be 1, 2, 3 or null';
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

  -- Setting a new 1st/2nd/3rd clears whichever pick currently holds that rank.
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
