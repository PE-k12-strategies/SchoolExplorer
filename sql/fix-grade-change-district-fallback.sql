-- Fix map detail "Enrollment by grade (From → To)" when the From year has
-- district grade rows but no school-level enrollment (common for 2015/2020).
-- Older nces_map_enrollment_by_grade_change only read nces_school_enrollment,
-- so From bars showed 0 and deltas looked like growth.
-- Run in Supabase → SQL Editor (safe to re-run).

drop function if exists public.nces_map_enrollment_by_grade_change(int, int, text, text);

create or replace function public.nces_map_enrollment_by_grade_change(
  p_year_from int,
  p_year_to int,
  p_leaid text default null,
  p_ncessch text default null
)
returns table (
  grade int,
  enrollment_from bigint,
  enrollment_to bigint,
  enrollment_delta bigint,
  enrollment_pct numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_approved() then
    raise exception 'Not authorized';
  end if;

  if p_year_from is null or p_year_to is null then
    raise exception 'p_year_from and p_year_to are required';
  end if;

  if (p_ncessch is null or p_ncessch = '') and (p_leaid is null or p_leaid = '') then
    raise exception 'p_ncessch or p_leaid is required';
  end if;

  -- School scope: school enrollment only.
  if p_ncessch is not null and p_ncessch <> '' then
    return query
    with base as (
      select
        se.grade,
        se.school_year,
        coalesce(sum(se.enrollment), 0)::bigint as enrollment
      from public.nces_school_enrollment se
      where se.school_year in (p_year_from, p_year_to)
        and se.race = 99
        and se.sex = 99
        and se.grade between -1 and 12
        and se.ncessch = p_ncessch
      group by se.grade, se.school_year
    ),
    grades as (
      select distinct b.grade from base b
    )
    select
      g.grade,
      coalesce(f.enrollment, 0)::bigint as enrollment_from,
      coalesce(t.enrollment, 0)::bigint as enrollment_to,
      (coalesce(t.enrollment, 0) - coalesce(f.enrollment, 0))::bigint as enrollment_delta,
      case when coalesce(f.enrollment, 0) > 0
        then round(((coalesce(t.enrollment, 0) - f.enrollment)::numeric / f.enrollment) * 100, 1)
        else null end as enrollment_pct
    from grades g
    left join base f on f.grade = g.grade and f.school_year = p_year_from
    left join base t on t.grade = g.grade and t.school_year = p_year_to
    where coalesce(f.enrollment, 0) > 0 or coalesce(t.enrollment, 0) > 0
    order by g.grade;
    return;
  end if;

  -- District scope: prefer nces_district_enrollment per year (same as
  -- nces_map_enrollment_by_grade), else sum school enrollment for that year.
  return query
  with dist as (
    select
      de.grade,
      de.school_year,
      coalesce(sum(de.enrollment), 0)::bigint as enrollment
    from public.nces_district_enrollment de
    where de.school_year in (p_year_from, p_year_to)
      and de.race = 99
      and de.sex = 99
      and de.grade between -1 and 12
      and de.leaid = p_leaid
    group by de.grade, de.school_year
  ),
  sch as (
    select
      se.grade,
      se.school_year,
      coalesce(sum(se.enrollment), 0)::bigint as enrollment
    from public.nces_school_enrollment se
    where se.school_year in (p_year_from, p_year_to)
      and se.race = 99
      and se.sex = 99
      and se.grade between -1 and 12
      and se.leaid = p_leaid
    group by se.grade, se.school_year
  ),
  base as (
    select d.grade, d.school_year, d.enrollment
    from dist d
    union all
    select s.grade, s.school_year, s.enrollment
    from sch s
    where not exists (
      select 1 from dist d2 where d2.school_year = s.school_year
    )
  ),
  grades as (
    select distinct b.grade from base b
  )
  select
    g.grade,
    coalesce(f.enrollment, 0)::bigint as enrollment_from,
    coalesce(t.enrollment, 0)::bigint as enrollment_to,
    (coalesce(t.enrollment, 0) - coalesce(f.enrollment, 0))::bigint as enrollment_delta,
    case when coalesce(f.enrollment, 0) > 0
      then round(((coalesce(t.enrollment, 0) - f.enrollment)::numeric / f.enrollment) * 100, 1)
      else null end as enrollment_pct
  from grades g
  left join base f on f.grade = g.grade and f.school_year = p_year_from
  left join base t on t.grade = g.grade and t.school_year = p_year_to
  where coalesce(f.enrollment, 0) > 0 or coalesce(t.enrollment, 0) > 0
  order by g.grade;
end;
$$;

grant execute on function public.nces_map_enrollment_by_grade_change(int, int, text, text) to authenticated;

-- Quick check (Jeffco example — From should be > 0 for 2020):
-- select * from public.nces_map_enrollment_by_grade_change(2020, 2024, '0804800', null)
-- order by grade;
