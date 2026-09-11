-- A quaddie leg whose race was abandoned (never run) has no winner. Mark it so
-- the results sync can settle the meeting on the legs that did run instead of
-- leaving it stuck in 'locked' forever waiting on a winner that cannot exist.

alter table public.legs
  add column abandoned boolean not null default false;
