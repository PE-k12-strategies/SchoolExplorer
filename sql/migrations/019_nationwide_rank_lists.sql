-- Nationwide school / district ranking (capped) for compare-all-states.
-- Extends 012: p_state may be null; p_limit caps nationwide result size.
-- Also adds nces_rank_school_changes for year-over-year school compare.
-- Safe to re-run.

drop function if exists public.nces_rank_schools(text, int);
drop function if exists public.nces_rank_schools(text, int, int);
drop function if exists public.nces_rank_districts(text, int);
drop function if exists public.nces_rank_districts(text, int, int);
drop function if exists public.nces_rank_school_changes(int, int, text, int);

create or replace function public.nces_rank_schools(
  p_state text default null,
  p_year int default null,
  p_limit int default null
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
  lim int;
  st text;
begin
  if not public.is_approved() then
    raise exception 'Not authorized';
  end if;
  yr := coalesce(p_year, public.nces_latest_school_year());
  st := nullif(trim(coalesce(p_state, '')), '');
  -- Nationwide defaults to top 500 by enrollment (full state lists stay uncapped).
  lim := case
    when p_limit is not null and p_limit > 0 then least(p_limit, 5000)
    when st is null then 500
    else null
  end;

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
      st is null
      or sd.state_location = st
      or d.state_code = st
    )
  order by coalesce(e.enrollment, 0) desc, sd.ncessch
  limit lim;
end;
$$;

create or replace function public.nces_rank_districts(
  p_state text default null,
  p_year int default null,
  p_limit int default null
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
  lim int;
  st text;
begin
  if not public.is_approved() then
    raise exception 'Not authorized';
  end if;
  yr := coalesce(p_year, public.nces_latest_school_year());
  st := nullif(trim(coalesce(p_state, '')), '');
  lim := case
    when p_limit is not null and p_limit > 0 then least(p_limit, 10000)
    when st is null then 1000
    else null
  end;

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
    and (st is null or d.state_code = st)
  order by coalesce(dd.enrollment, 0) desc, d.leaid
  limit lim;
end;
$$;

-- Top schools by absolute enrollment change (nationwide-safe with p_limit).
create or replace function public.nces_rank_school_changes(
  p_year_from int,
  p_year_to int,
  p_state text default null,
  p_limit int default 500
)
returns table (
  ncessch text,
  leaid text,
  school_name text,
  district_name text,
  state_code text,
  enrollment_from bigint,
  enrollment_to bigint,
  enrollment_delta bigint,
  teachers_fte numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lim int;
  st text;
begin
  if not public.is_approved() then
    raise exception 'Not authorized';
  end if;
  if p_year_from is null or p_year_to is null then
    raise exception 'p_year_from and p_year_to are required';
  end if;
  st := nullif(trim(coalesce(p_state, '')), '');
  lim := case
    when p_limit is not null and p_limit > 0 then least(p_limit, 5000)
    when st is null then 500
    else 5000
  end;

  return query
  with enroll as (
    select
      se.ncessch,
      se.school_year,
      sum(se.enrollment)::bigint as enrollment
    from public.nces_school_enrollment se
    where se.school_year in (p_year_from, p_year_to)
      and se.race = 99
      and se.sex = 99
      and se.grade between -1 and 12
    group by se.ncessch, se.school_year
  ),
  pivoted as (
    select
      coalesce(a.ncessch, b.ncessch) as ncessch,
      coalesce(a.enrollment, 0)::bigint as enrollment_from,
      coalesce(b.enrollment, 0)::bigint as enrollment_to
    from (select * from enroll where school_year = p_year_from) a
    full outer join (select * from enroll where school_year = p_year_to) b
      on a.ncessch = b.ncessch
  )
  select
    p.ncessch,
    coalesce(sd_to.leaid, sd_from.leaid) as leaid,
    coalesce(sd_to.school_name, sd_from.school_name) as school_name,
    coalesce(d.district_name, dd.lea_name) as district_name,
    coalesce(d.state_code, sd_to.state_location, sd_from.state_location) as state_code,
    p.enrollment_from,
    p.enrollment_to,
    (p.enrollment_to - p.enrollment_from)::bigint as enrollment_delta,
    coalesce(sd_to.teachers_fte, sd_from.teachers_fte) as teachers_fte
  from pivoted p
  left join public.nces_school_directory sd_to
    on sd_to.ncessch = p.ncessch and sd_to.school_year = p_year_to
  left join public.nces_school_directory sd_from
    on sd_from.ncessch = p.ncessch and sd_from.school_year = p_year_from
  left join public.nces_sync_districts d
    on d.leaid = coalesce(sd_to.leaid, sd_from.leaid)
  left join public.nces_district_directory dd
    on dd.leaid = coalesce(sd_to.leaid, sd_from.leaid)
   and dd.school_year = p_year_to
  where coalesce(sd_to.ncessch, sd_from.ncessch) is not null
    and (
      st is null
      or coalesce(d.state_code, sd_to.state_location, sd_from.state_location) = st
    )
  order by abs(p.enrollment_to - p.enrollment_from) desc, p.ncessch
  limit lim;
end;
$$;

grant execute on function public.nces_rank_schools(text, int, int) to authenticated;
grant execute on function public.nces_rank_districts(text, int, int) to authenticated;
grant execute on function public.nces_rank_school_changes(int, int, text, int) to authenticated;
