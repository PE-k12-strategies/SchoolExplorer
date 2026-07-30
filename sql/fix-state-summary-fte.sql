-- Fix state Color-by for Teachers / Staff / Stud-teacher.
-- Older nces_map_state_summary only returned enrollment, so those modes painted blank.
-- Run in Supabase → SQL Editor (safe to re-run).

drop function if exists public.nces_map_state_summary(int);

create or replace function public.nces_map_state_summary(p_year int default null)
returns table (
  state_code text,
  districts int,
  schools bigint,
  enrollment bigint,
  teachers_fte numeric,
  staff_fte numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  yr int;
begin
  if not public.is_approved() then
    raise exception 'Not authorized';
  end if;
  yr := coalesce(p_year, public.nces_latest_school_year());

  return query
  select
    dd.state_location as state_code,
    count(distinct dd.leaid)::int as districts,
    coalesce(sum(dd.number_of_schools), 0)::bigint as schools,
    coalesce(sum(dd.enrollment), 0)::bigint as enrollment,
    coalesce(sum(dd.teachers_total_fte), 0)::numeric as teachers_fte,
    coalesce(sum(dd.staff_total_fte), 0)::numeric as staff_fte
  from public.nces_district_directory dd
  where dd.school_year = yr
    and dd.state_location is not null
  group by dd.state_location
  order by dd.state_location;
end;
$$;

grant execute on function public.nces_map_state_summary(int) to authenticated;

-- Quick check (should show teachers_fte / staff_fte > 0 for large states):
-- select * from public.nces_map_state_summary(2024)
-- where state_code in ('CA', 'TX', 'NY', 'FL')
-- order by state_code;
