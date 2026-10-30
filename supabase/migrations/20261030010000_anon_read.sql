-- Visitors can read the cards before (or without) an anonymous session.
-- The browser creates that session on the visitor's own IP. Until it exists,
-- the server uses the anon key, which is the `anon` role — not `authenticated`.
-- Writes stay authenticated-only. Not applied by this change; apply with the deploy.

grant select on public.profiles to anon;
grant select on public.meetings to anon;
grant select on public.legs to anon;
grant select on public.runners to anon;
grant select on public.picks to anon;
grant select on public.comments to anon;
grant select on public.leg_comments to anon;
grant select on public.sync_log to anon;

create policy "profiles_select_anon"
  on public.profiles for select to anon using (true);
create policy "meetings_select_anon"
  on public.meetings for select to anon using (true);
create policy "legs_select_anon"
  on public.legs for select to anon using (true);
create policy "runners_select_anon"
  on public.runners for select to anon using (true);
create policy "picks_select_anon"
  on public.picks for select to anon using (true);
create policy "comments_select_anon"
  on public.comments for select to anon using (true);
create policy "leg_comments_select_anon"
  on public.leg_comments for select to anon using (true);
create policy "sync_log_select_anon"
  on public.sync_log for select to anon using (true);
