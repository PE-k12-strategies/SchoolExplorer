-- Diagnose + fix jeffco_room_schedule access
-- Run in Supabase SQL Editor (paste this whole file)

-- 1) How many rows exist? (SQL Editor bypasses RLS)
select count(*) as row_count from public.jeffco_room_schedule;

-- 2) Sample columns (confirms CSV imported and header names)
select * from public.jeffco_room_schedule limit 3;

-- 3) Ensure is_approved() exists (from sql/setup.sql)
create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where auth_user_id = auth.uid()
      and approval_status = 'approved'
  );
$$;

-- 4) RLS policies for approved users + admin
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

-- 5) Dashboard diagnostic (called from dashboard.html when no rows load)
create or replace function public.dashboard_data_hint()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  total bigint;
  approved boolean;
  rls_enabled boolean;
  policy_count int;
begin
  approved := public.is_approved();
  select count(*) into total from public.jeffco_room_schedule;
  select c.relrowsecurity into rls_enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'jeffco_room_schedule';
  select count(*)::int into policy_count
    from pg_policies
    where schemaname = 'public' and tablename = 'jeffco_room_schedule';

  return json_build_object(
    'approved', approved,
    'table_rows', total,
    'rls_enabled', coalesce(rls_enabled, false),
    'policy_count', coalesce(policy_count, 0)
  );
end;
$$;

grant execute on function public.dashboard_data_hint() to authenticated;
