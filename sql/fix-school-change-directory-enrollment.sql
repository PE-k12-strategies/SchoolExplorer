-- Fix school-marker Change colors for early years (2015/2020).
-- nces_map_school_metric_change / nces_map_school_points only summed
-- nces_school_enrollment; when that year wasn't synced, From enrollment was 0
-- (gray / misleading dots) even though CCD directory has enrollment in raw_data.
-- Run in Supabase → SQL Editor (safe to re-run). Prefer after 014.

create index if not exists nces_school_enrollment_totals_idx
  on public.nces_school_enrollment (leaid, school_year, ncessch)
  where race = 99 and sex = 99 and grade between -1 and 12;

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
    coalesce(
      (
        select sum(se.enrollment)
        from public.nces_school_enrollment se
        where se.ncessch = sd.ncessch
          and se.school_year = yr
          and se.race = 99
          and se.sex = 99
          and se.grade between -1 and 12
      ),
      nullif(sd.raw_data ->> 'enrollment', '')::numeric,
      nullif(sd.raw_data ->> 'enrollment_fall_school', '')::numeric,
      0
    )::bigint as enrollment,
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

drop function if exists public.nces_map_school_metric_change(int, int, text, text);
drop function if exists public.nces_map_school_metric_change(int, int, text, text, text);

create or replace function public.nces_map_school_metric_change(
  p_year_from int,
  p_year_to int,
  p_state text default null,
  p_leaid text default null,
  p_ncessch text default null
)
returns table (
  ncessch text,
  leaid text,
  school_name text,
  enrollment_from bigint,
  enrollment_to bigint,
  enrollment_delta bigint,
  enrollment_pct numeric,
  teachers_from numeric,
  teachers_to numeric,
  teachers_delta numeric,
  teachers_pct numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_approved() then
    raise exception 'Not authorized';
  end if;

  if p_year_from is null or p_year_to is null then
    raise exception 'p_year_from and p_year_to are required';
  end if;

  perform set_config('statement_timeout', '120s', true);

  if p_state is null and p_leaid is null and (p_ncessch is null or p_ncessch = '') then
    raise exception 'Pick a state or district — nationwide school change is too large';
  end if;

  return query
  with lea_scope as (
    select sd.leaid
    from public.nces_sync_districts sd
    where sd.enabled = true
      and (p_state is null or sd.state_code = p_state)
      and (p_leaid is null or sd.leaid = p_leaid)
    union
    select d.leaid
    from public.nces_school_directory d
    where p_leaid is not null and d.leaid = p_leaid
    union
    select d.leaid
    from public.nces_school_directory d
    where p_ncessch is not null and p_ncessch <> '' and d.ncessch = p_ncessch
  ),
  enroll as (
    select
      se.ncessch as sch_id,
      se.leaid as lea_id,
      se.school_year as yr,
      coalesce(sum(se.enrollment), 0)::bigint as enrollment
    from public.nces_school_enrollment se
    inner join lea_scope ls on ls.leaid = se.leaid
    where se.school_year in (p_year_from, p_year_to)
      and se.race = 99
      and se.sex = 99
      and se.grade between -1 and 12
      and (p_ncessch is null or se.ncessch = p_ncessch)
    group by se.ncessch, se.leaid, se.school_year
  ),
  dir as (
    select
      sd.ncessch as sch_id,
      sd.leaid as lea_id,
      sd.school_year as yr,
      sd.school_name as sch_name,
      coalesce(sd.teachers_fte, 0) as teachers_fte,
      coalesce(
        nullif(sd.raw_data ->> 'enrollment', '')::numeric,
        nullif(sd.raw_data ->> 'enrollment_fall_school', '')::numeric,
        0
      )::bigint as dir_enrollment
    from public.nces_school_directory sd
    inner join lea_scope ls on ls.leaid = sd.leaid
    where sd.school_year in (p_year_from, p_year_to)
      and (p_ncessch is null or sd.ncessch = p_ncessch)
      and (p_state is null or sd.state_location = p_state)
  ),
  ids as (
    select distinct sch_id from enroll
    union
    select distinct sch_id from dir
  )
  select
    i.sch_id,
    coalesce(d_to.lea_id, d_from.lea_id, e_to.lea_id, e_from.lea_id),
    coalesce(d_to.sch_name, d_from.sch_name, i.sch_id),
    coalesce(e_from.enrollment, d_from.dir_enrollment, 0)::bigint,
    coalesce(e_to.enrollment, d_to.dir_enrollment, 0)::bigint,
    (coalesce(e_to.enrollment, d_to.dir_enrollment, 0)
      - coalesce(e_from.enrollment, d_from.dir_enrollment, 0))::bigint,
    case when coalesce(e_from.enrollment, d_from.dir_enrollment, 0) > 0
      then round((
        (coalesce(e_to.enrollment, d_to.dir_enrollment, 0)
          - coalesce(e_from.enrollment, d_from.dir_enrollment, 0))::numeric
        / coalesce(e_from.enrollment, d_from.dir_enrollment, 0)
      ) * 100, 1)
      else null end,
    coalesce(d_from.teachers_fte, 0),
    coalesce(d_to.teachers_fte, 0),
    (coalesce(d_to.teachers_fte, 0) - coalesce(d_from.teachers_fte, 0)),
    case when coalesce(d_from.teachers_fte, 0) > 0
      then round(((coalesce(d_to.teachers_fte, 0) - d_from.teachers_fte) / d_from.teachers_fte) * 100, 1)
      else null end
  from ids i
  left join enroll e_from on e_from.sch_id = i.sch_id and e_from.yr = p_year_from
  left join enroll e_to on e_to.sch_id = i.sch_id and e_to.yr = p_year_to
  left join dir d_from on d_from.sch_id = i.sch_id and d_from.yr = p_year_from
  left join dir d_to on d_to.sch_id = i.sch_id and d_to.yr = p_year_to
  where coalesce(e_from.enrollment, d_from.dir_enrollment, 0) > 0
     or coalesce(e_to.enrollment, d_to.dir_enrollment, 0) > 0
     or coalesce(d_from.teachers_fte, 0) > 0
     or coalesce(d_to.teachers_fte, 0) > 0
  order by i.sch_id;
end;
$$;

grant execute on function public.nces_map_school_points(text, text, int) to authenticated;
grant execute on function public.nces_map_school_metric_change(int, int, text, text, text) to authenticated;

-- Quick check (Jeffco — From enrollment should be > 0 for 2020):
-- select ncessch, enrollment_from, enrollment_to, enrollment_pct
-- from public.nces_map_school_metric_change(2020, 2024, 'CO', '0804800', null)
-- where enrollment_from > 0
-- limit 20;
