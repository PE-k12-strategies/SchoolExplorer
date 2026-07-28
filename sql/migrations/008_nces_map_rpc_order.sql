-- Stable ORDER BY on large map RPCs so PostgREST .range() pagination
-- (used by the map client) never skips/duplicates rows.
-- Optional if you re-run updated 005 + 007; safe to re-run alone.
-- Does not change return shapes — only add ORDER BY.

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

grant execute on function public.nces_map_school_points(text, text, int) to authenticated;
grant execute on function public.nces_map_district_points(text, int) to authenticated;
