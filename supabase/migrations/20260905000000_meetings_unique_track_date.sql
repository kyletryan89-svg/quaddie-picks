-- One row per (track, meeting_date). A duplicate Sandown was created manually
-- alongside the synced one because nothing prevented it. Dedupe first, then
-- enforce so it can never happen again.

-- Keep, for each (track, meeting_date), the row with a feed source (synced)
-- when one exists, else the earliest-created row. Deleting the losers cascades
-- their legs, runners, picks, comments and sync_log rows.
with ranked as (
  select id,
         row_number() over (
           partition by track, meeting_date
           order by (source_key is not null) desc, created_at asc, id asc
         ) as rn
  from public.meetings
)
delete from public.meetings
where id in (select id from ranked where rn > 1);

alter table public.meetings
  add constraint meetings_track_meeting_date_unique unique (track, meeting_date);
