-- M11: automated field ingestion.
--
-- 1. legs gain field_source / winner_source so a feed sync never overwrites a
--    value a member entered by hand (paste = field 'manual', settle = winner
--    'manual'; the cron/sync writes 'feed').
-- 2. replace_leg_field now stamps field_source = 'manual'.
-- 3. sync_log records every sync run so failures can surface on the meeting
--    screen, not just as a hidden log row.

-- ─── source tracking on legs ─────────────────────────────────────────────────
alter table public.legs add column field_source  text check (field_source  in ('feed','manual'));
alter table public.legs add column winner_source text check (winner_source in ('feed','manual'));

-- ─── replace_leg_field: stamp the field as manually entered ──────────────────
-- Recreated (not altered) because it is a security-definer function and the new
-- body must set field_source while keeping the same trust model.
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
       and m.status = 'open'
  ) then
    raise exception 'the field can only be set while the meeting is open';
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

  -- The field is now member-owned: the feed sync must not touch it again.
  update public.legs set field_source = 'manual' where id = p_leg_id;

  return query
    select * from public.runners where leg_id = p_leg_id order by runner_number;
end $$;

revoke all on function public.replace_leg_field(uuid, jsonb) from public;
grant execute on function public.replace_leg_field(uuid, jsonb) to authenticated;

-- ─── sync_log ────────────────────────────────────────────────────────────────
create table public.sync_log (
  id          uuid primary key default gen_random_uuid(),
  job         text not null,
  provider    text not null,
  meeting_id  uuid references public.meetings(id) on delete cascade,
  started     timestamptz not null default now(),
  finished    timestamptz,
  rows_touched int not null default 0,
  error       text
);

create index sync_log_meeting_id_idx on public.sync_log (meeting_id, started desc);

alter table public.sync_log enable row level security;

-- Members may read the log (the meeting screen shows a banner on failure) and
-- insert (the "Sync now" button runs with the member's own session). Cron runs
-- use the service role, which bypasses RLS.
create policy "sync_log_select_authenticated"
  on public.sync_log for select to authenticated using (true);
create policy "sync_log_insert_authenticated"
  on public.sync_log for insert to authenticated with check (true);
