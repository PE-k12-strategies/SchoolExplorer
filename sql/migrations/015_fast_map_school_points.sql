-- Faster nces_map_school_points for large states (TX ~9k schools).
-- Replaces correlated per-row enrollment subquery with a single grouped join.
-- Safe to re-run.

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

  -- Require a scope — nationwide school points are too large for the map.
  if p_state is null and p_leaid is null then
    raise exception 'Pick a state or district — nationwide school points are too large';
  end if;

  yr := coalesce(p_year, public.nces_latest_school_year());

  return query
  with enroll as (
    select
      se.ncessch,
      coalesce(sum(se.enrollment), 0)::bigint as enrollment
    from public.nces_school_enrollment se
    where se.school_year = yr
      and se.race = 99
      and se.sex = 99
      and se.grade between -1 and 12
      and (p_leaid is null or se.leaid = p_leaid)
    group by se.ncessch
  )
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
    coalesce(e.enrollment, 0)::bigint,
    sd.teachers_fte
  from public.nces_school_directory sd
  left join enroll e on e.ncessch = sd.ncessch
  where sd.school_year = yr
    and sd.latitude is not null
    and sd.longitude is not null
    and (p_state is null or sd.state_location = p_state)
    and (p_leaid is null or sd.leaid = p_leaid)
  order by sd.ncessch;
end;
$$;

grant execute on function public.nces_map_school_points(text, text, int) to authenticated;

-- Help the enroll CTE + directory filters.
create index if not exists nces_school_directory_state_year_coords_idx
  on public.nces_school_directory (state_location, school_year)
  where latitude is not null and longitude is not null;
