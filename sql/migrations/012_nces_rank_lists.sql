-- Fast school / district ranking lists for dashboard filters (no map lat/long).
-- Prefer these over nces_map_school_points / nces_map_district_points for rankings.
-- Safe to re-run.

drop function if exists public.nces_rank_schools(text, int);
drop function if exists public.nces_rank_districts(text, int);

create or replace function public.nces_rank_schools(
  p_state text,
  p_year int default null
)
returns table (
  ncessch text,
  leaid text,
  school_name text,
  district_name text,
  state_code text,
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
  if p_state is null or length(trim(p_state)) = 0 then
    raise exception 'p_state is required (pick a state — nationwide school rank is too large)';
  end if;
  yr := coalesce(p_year, public.nces_latest_school_year());

  return query
  with enroll as (
    select
      se.ncessch,
      sum(se.enrollment)::bigint as enrollment
    from public.nces_school_enrollment se
    where se.school_year = yr
      and se.race = 99
      and se.sex = 99
      and se.grade between -1 and 12
    group by se.ncessch
  )
  select
    sd.ncessch,
    sd.leaid,
    sd.school_name,
    coalesce(d.district_name, dd.lea_name) as district_name,
    coalesce(d.state_code, sd.state_location) as state_code,
    coalesce(e.enrollment, 0)::bigint as enrollment,
    sd.teachers_fte
  from public.nces_school_directory sd
  left join public.nces_sync_districts d on d.leaid = sd.leaid
  left join public.nces_district_directory dd
    on dd.leaid = sd.leaid and dd.school_year = yr
  left join enroll e on e.ncessch = sd.ncessch
  where sd.school_year = yr
    and (
      sd.state_location = p_state
      or d.state_code = p_state
    )
  order by coalesce(e.enrollment, 0) desc, sd.ncessch;
end;
$$;

create or replace function public.nces_rank_districts(
  p_state text,
  p_year int default null
)
returns table (
  leaid text,
  district_name text,
  state_code text,
  enrollment int,
  teachers_fte numeric,
  schools bigint
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
  if p_state is null or length(trim(p_state)) = 0 then
    raise exception 'p_state is required';
  end if;
  yr := coalesce(p_year, public.nces_latest_school_year());

  return query
  select
    d.leaid,
    coalesce(d.district_name, dd.lea_name) as district_name,
    d.state_code,
    coalesce(dd.enrollment, 0)::int as enrollment,
    dd.teachers_total_fte as teachers_fte,
    coalesce(dd.number_of_schools, 0)::bigint as schools
  from public.nces_sync_districts d
  left join public.nces_district_directory dd
    on dd.leaid = d.leaid and dd.school_year = yr
  where d.enabled is distinct from false
    and d.state_code = p_state
  order by coalesce(dd.enrollment, 0) desc, d.leaid;
end;
$$;

grant execute on function public.nces_rank_schools(text, int) to authenticated;
grant execute on function public.nces_rank_districts(text, int) to authenticated;
