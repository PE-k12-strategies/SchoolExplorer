-- Allow approved users to read jeffco_room_schedule
-- Run once in Supabase SQL Editor

alter table public.jeffco_room_schedule enable row level security;

drop policy if exists "Approved users can read jeffco_room_schedule" on public.jeffco_room_schedule;
create policy "Approved users can read jeffco_room_schedule"
  on public.jeffco_room_schedule for select
  to authenticated
  using (public.is_approved());

drop policy if exists "Admin can manage jeffco_room_schedule" on public.jeffco_room_schedule;
create policy "Admin can manage jeffco_room_schedule"
  on public.jeffco_room_schedule for all
  to authenticated
  using ((auth.jwt() ->> 'email') = 'k12strategies@perkinseastman.com')
  with check ((auth.jwt() ->> 'email') = 'k12strategies@perkinseastman.com');

drop policy if exists "Deny anonymous read jeffco_room_schedule" on public.jeffco_room_schedule;
create policy "Deny anonymous read jeffco_room_schedule"
  on public.jeffco_room_schedule for select
  to anon
  using (false);
