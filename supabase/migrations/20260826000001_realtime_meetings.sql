-- Broadcast meeting status changes (open → locked → settled) so every member's
-- screen reacts to a lock/settle WITHOUT reloading (SPEC §6, rubric R5).
alter publication supabase_realtime add table public.meetings;
