-- NCES map support: school coordinates + aggregation RPCs for the map layers
-- Run in Supabase SQL Editor after 001, 002, 003. Safe to re-run.

-- 1) School coordinates -------------------------------------------------------
alter table public.nces_school_directory
  add column if not exists latitude numeric;
alter table public.nces_school_directory
  add column if not exists longitude numeric;

-- Backfill from the stored raw API row (Urban Institute CCD directory includes
-- latitude/longitude). Only fills rows that are currently null.
update public.nces_school_directory
set
  latitude = nullif(raw_data ->> 'latitude', '')::numeric,
  longitude = nullif(raw_data ->> 'longitude', '')::numeric
where latitude is null
  and raw_data ? 'latitude'
  and coalesce(raw_data ->> 'latitude', '') <> '';

create index if not exists nces_school_directory_coords_idx
  on public.nces_school_directory (state_location, school_year)
  where latitude is not null and longitude is not null;

-- 2) Helper: resolve the latest year present when caller passes null ----------
create or replace function public.nces_latest_school_year()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(school_year), extract(year from now())::int)
  from public.nces_school_directory;
$$;

-- 3) State-level summary (map States layer) -----------------------------------
-- One row per state that has synced district data.
-- Drop first: CREATE OR REPLACE cannot change OUT/return row types.
drop function if exists public.nces_map_state_summary(int);
drop function if exists public.nces_map_district_points(text, int);
drop function if exists public.nces_map_school_points(text, text, int);

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

-- 4) District-level points (map Districts layer) ------------------------------
-- District centroid = mean of its schools' coordinates for the year.
create or replace function public.nces_map_district_points(
  p_state text default null,
  p_year int default null
)
returns table (
  leaid text,
  district_name text,
  latitude numeric,
  longitude numeric,
  schools bigint,
  enrollment int,
  lowest_grade int,
  highest_grade int
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
    sd.leaid,
    coalesce(max(d.district_name), max(dd.lea_name)) as district_name,
    avg(sd.latitude) as latitude,
    avg(sd.longitude) as longitude,
    count(*)::bigint as schools,
    max(dd.enrollment) as enrollment,
    min(sd.lowest_grade_offered) as lowest_grade,
    max(sd.highest_grade_offered) as highest_grade
  from public.nces_school_directory sd
  left join public.nces_sync_districts d on d.leaid = sd.leaid
  left join public.nces_district_directory dd
    on dd.leaid = sd.leaid and dd.school_year = yr
  where sd.school_year = yr
    and sd.latitude is not null
    and sd.longitude is not null
    and (p_state is null or sd.state_location = p_state)
  group by sd.leaid;
end;
$$;

-- 5) School-level points (map Schools layer) ----------------------------------
create or replace function public.nces_map_school_points(
  p_state text default null,
  p_leaid text default null,
  p_year int default null
)
returns table (
  ncessch text,
  leaid text,
  school_name text,
  latitude numeric,
  longitude numeric,
  school_level int,
  charter int,
  lowest_grade int,
  highest_grade int,
  enrollment bigint
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
    sd.ncessch,
    sd.leaid,
    sd.school_name,
    sd.latitude,
    sd.longitude,
    sd.school_level,
    sd.charter,
    sd.lowest_grade_offered as lowest_grade,
    sd.highest_grade_offered as highest_grade,
    coalesce((
      select sum(se.enrollment)
      from public.nces_school_enrollment se
      where se.ncessch = sd.ncessch
        and se.school_year = yr
        and se.race = 99
        and se.sex = 99
        and se.grade between -1 and 12
    ), 0)::bigint as enrollment
  from public.nces_school_directory sd
  where sd.school_year = yr
    and sd.latitude is not null
    and sd.longitude is not null
    and (p_state is null or sd.state_location = p_state)
    and (p_leaid is null or sd.leaid = p_leaid);
end;
$$;

grant execute on function public.nces_latest_school_year() to authenticated;
grant execute on function public.nces_map_state_summary(int) to authenticated;
grant execute on function public.nces_map_district_points(text, int) to authenticated;
grant execute on function public.nces_map_school_points(text, text, int) to authenticated;
