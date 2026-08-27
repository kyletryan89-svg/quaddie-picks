-- M8: real fields and tap-to-pick.
--
-- Picks were free text: a member typed a runner number and an optional name, so
-- the same horse could arrive as "7", "7 Winx" and "7 winx" from three people.
-- A leg now has a real field of runners, and a pick simply points at one.

-- ─── runners ────────────────────────────────────────────────────────────────
create table public.runners (
  id            uuid primary key default gen_random_uuid(),
  leg_id        uuid not null references public.legs(id) on delete cascade,
  runner_number int  not null,
  runner_name   text,
  scratched     boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (leg_id, runner_number),
  -- Lets picks carry a composite (leg_id, runner_id) foreign key, which makes a
  -- pick pointing at a runner from a different leg unrepresentable.
  unique (leg_id, id)
);

create index runners_leg_id_idx on public.runners (leg_id);

alter table public.runners enable row level security;

-- Any authenticated member may read the field and paste one in. There is no
-- delete policy, so no client can delete a runner directly; replacing a leg's
-- field goes through replace_leg_field() below.
create policy "runners_select_authenticated"
  on public.runners for select to authenticated using (true);
create policy "runners_insert_authenticated"
  on public.runners for insert to authenticated with check (true);

-- ─── migrate picks onto runner_id ───────────────────────────────────────────
-- Every existing pick already carries the number it was typed as, so the field
-- can be reconstructed from the picks themselves and every pick matched. A pick
-- that still fails to match is dropped — this is seed data only.
insert into public.runners (leg_id, runner_number, runner_name)
select p.leg_id, p.runner_number, max(p.runner_name)
from public.picks p
group by p.leg_id, p.runner_number
on conflict (leg_id, runner_number) do nothing;

alter table public.picks add column runner_id uuid;

update public.picks p
   set runner_id = r.id
  from public.runners r
 where r.leg_id = p.leg_id
   and r.runner_number = p.runner_number;

delete from public.picks where runner_id is null;

-- Drop the old free-text uniqueness (leg_id, user_id, runner_number) whatever
-- Postgres happened to name it.
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.picks'::regclass and contype = 'u'
  loop
    execute format('alter table public.picks drop constraint %I', c);
  end loop;
end $$;

alter table public.picks alter column runner_id set not null;
alter table public.picks drop column runner_number;
alter table public.picks drop column runner_name;

-- One pick per member per runner, and the runner must belong to the pick's leg.
alter table public.picks add constraint picks_user_id_runner_id_key unique (user_id, runner_id);
alter table public.picks add constraint picks_runner_in_leg_fkey
  foreign key (leg_id, runner_id) references public.runners (leg_id, id) on delete cascade;

create index picks_runner_id_idx on public.picks (runner_id);

-- ─── replace a leg's field ──────────────────────────────────────────────────
-- Re-pasting must be able to remove runners, but clients hold no delete
-- privilege on runners (deliberately — see the policies above). This runs as
-- the definer so the replace is possible, while still refusing anyone who is
-- not authenticated and any meeting that is not open.
--
-- Runners that survive the re-paste keep their id, so picks on them survive
-- too; only runners dropped from the field lose their picks, via cascade.
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

  return query
    select * from public.runners where leg_id = p_leg_id order by runner_number;
end $$;

revoke all on function public.replace_leg_field(uuid, jsonb) from public;
grant execute on function public.replace_leg_field(uuid, jsonb) to authenticated;
