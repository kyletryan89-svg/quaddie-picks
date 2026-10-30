-- Picks stay open until a meeting is settled.
--
-- `meetings.status = 'locked'` is no longer a gate. Existing rows may still
-- say 'locked'; those rows accept picks, ranking, and field pastes, and they
-- can be settled (open or locked → settled). A settled meeting rejects pick
-- writes. Not applied to production by this change — run it when ready.
--
-- Columns left in place but unused by the app: meetings.reopened_by,
-- meetings.reopened_at. The status value 'locked' is still allowed by the
-- check constraint so old rows remain valid; the app does not write it.

drop policy if exists "picks_insert_own_open_meeting" on public.picks;
drop policy if exists "picks_insert_own_until_settled" on public.picks;
create policy "picks_insert_own_until_settled"
  on public.picks for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.meetings m
      join public.legs l on l.meeting_id = m.id
      where l.id = leg_id
        and m.status <> 'settled'
    )
  );

drop policy if exists "picks_delete_own_open_meeting" on public.picks;
drop policy if exists "picks_delete_own_until_settled" on public.picks;
create policy "picks_delete_own_until_settled"
  on public.picks for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.meetings m
      join public.legs l on l.meeting_id = m.id
      where l.id = leg_id
        and m.status <> 'settled'
    )
  );

-- Latest body is 20260902000000 (ranks 1, 2 and 3). Only the status check changes.
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
       and m.status <> 'settled'
  ) then
    raise exception 'picks can only be ranked before the meeting is settled';
  end if;

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

-- Latest body is 20260831000000 (stamps field_source). Only the status check changes.
create or replace function public.replace_leg_field(p_leg_id uuid, p_runners jsonb)
returns setof public.runners
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if jsonb_typeof(p_runners) <> 'array' or jsonb_array_length(p_runners) = 0 then
    raise exception 'a field needs at least one runner';
  end if;

  if not exists (
    select 1
      from public.legs l
      join public.meetings m on m.id = l.meeting_id
     where l.id = p_leg_id
       and m.status <> 'settled'
  ) then
    raise exception 'the field can only be set before the meeting is settled';
  end if;

  insert into public.runners (leg_id, runner_number, runner_name)
  select p_leg_id, (e->>'number')::int, nullif(e->>'name', '')
    from jsonb_array_elements(p_runners) e
  on conflict (leg_id, runner_number)
  do update set runner_name = excluded.runner_name;

  delete from public.runners r
   where r.leg_id = p_leg_id
     and r.runner_number not in (
       select (e->>'number')::int from jsonb_array_elements(p_runners) e
     );

  update public.legs set field_source = 'manual' where id = p_leg_id;

  return query
    select * from public.runners where leg_id = p_leg_id order by runner_number;
end $$;

revoke all on function public.replace_leg_field(uuid, jsonb) from public;
grant execute on function public.replace_leg_field(uuid, jsonb) to authenticated;
