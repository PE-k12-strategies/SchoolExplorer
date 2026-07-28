-- NCES map enrichment: teachers/staff FTE + enrollment-by-grade for popups.
-- Run in Supabase SQL Editor AFTER 004_nces_map.sql. Safe to re-run.
-- Degrades gracefully on the client if a table is empty (returns 0 / no rows).

-- Drop & recreate so RETURNS TABLE columns can change.
drop function if exists public.nces_map_state_summary(int);
drop function if exists public.nces_map_district_points(text, int);
drop function if exists public.nces_map_school_points(text, text, int);
drop function if exists public.nces_map_enrollment_by_grade(text, text, int);

-- 1) State-level summary ------------------------------------------------------
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

-- 2) District-level points / polygons attributes ------------------------------
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
  teachers_fte numeric,
  staff_fte numeric,
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
    max(dd.teachers_total_fte) as teachers_fte,
    max(dd.staff_total_fte) as staff_fte,
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
  group by sd.leaid
  order by sd.leaid;
end;
$$;

-- 3) School-level points ------------------------------------------------------
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
  enrollment bigint,
  teachers_fte numeric
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
    ), 0)::bigint as enrollment,
    sd.teachers_fte
  from public.nces_school_directory sd
  where sd.school_year = yr
    and sd.latitude is not null
    and sd.longitude is not null
    and (p_state is null or sd.state_location = p_state)
    and (p_leaid is null or sd.leaid = p_leaid)
  order by sd.ncessch;
end;
$$;

-- 4) Enrollment by grade (for popup mini charts) ------------------------------
-- Pass either p_ncessch (school) or p_leaid (district). Prefer school when both set.
create or replace function public.nces_map_enrollment_by_grade(
  p_leaid text default null,
  p_ncessch text default null,
  p_year int default null
)
returns table (
  grade int,
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

  if p_ncessch is not null and p_ncessch <> '' then
    return query
    select se.grade, coalesce(sum(se.enrollment), 0)::bigint
    from public.nces_school_enrollment se
    where se.ncessch = p_ncessch
      and se.school_year = yr
      and se.race = 99
      and se.sex = 99
      and se.grade between -1 and 12
    group by se.grade
    order by se.grade;
  elsif p_leaid is not null and p_leaid <> '' then
    -- Prefer district enrollment table; fall back to summing school enrollment.
    return query
    with dist as (
      select de.grade, coalesce(sum(de.enrollment), 0)::bigint as enrollment
      from public.nces_district_enrollment de
      where de.leaid = p_leaid
        and de.school_year = yr
        and de.race = 99
        and de.sex = 99
        and de.grade between -1 and 12
      group by de.grade
    ),
    sch as (
      select se.grade, coalesce(sum(se.enrollment), 0)::bigint as enrollment
      from public.nces_school_enrollment se
      where se.leaid = p_leaid
        and se.school_year = yr
        and se.race = 99
        and se.sex = 99
        and se.grade between -1 and 12
      group by se.grade
    )
    select d.grade, d.enrollment from dist d
    where exists (select 1 from dist)
    union all
    select s.grade, s.enrollment from sch s
    where not exists (select 1 from dist)
    order by 1;
  end if;
end;
$$;

grant execute on function public.nces_map_state_summary(int) to authenticated;
grant execute on function public.nces_map_district_points(text, int) to authenticated;
grant execute on function public.nces_map_school_points(text, text, int) to authenticated;
grant execute on function public.nces_map_enrollment_by_grade(text, text, int) to authenticated;
