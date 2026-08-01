-- School/district per-grade enrollment change + school metric filter by ncessch.
-- Run after 007. Safe to re-run. Prefer re-running updated 007 instead if convenient.

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
begin
  if not public.is_approved() then
    raise exception 'Not authorized';
  end if;

  if p_year_from is null or p_year_to is null then
    raise exception 'p_year_from and p_year_to are required';
  end if;

  return query
  with enroll as (
    select
      se.ncessch,
      se.leaid,
      se.school_year,
      coalesce(sum(se.enrollment), 0)::bigint as enrollment
    from public.nces_school_enrollment se
    where se.school_year in (p_year_from, p_year_to)
      and se.race = 99
      and se.sex = 99
      and se.grade between -1 and 12
      and (p_leaid is null or se.leaid = p_leaid)
      and (p_ncessch is null or se.ncessch = p_ncessch)
      and (
        p_state is null
        or exists (
          select 1 from public.nces_school_directory sd
          where sd.ncessch = se.ncessch
            and sd.school_year = se.school_year
            and sd.state_location = p_state
        )
      )
    group by se.ncessch, se.leaid, se.school_year
  ),
  dir as (
    select
      sd.ncessch,
      sd.leaid,
      sd.school_year,
      sd.school_name,
      coalesce(sd.teachers_fte, 0) as teachers_fte
    from public.nces_school_directory sd
    where sd.school_year in (p_year_from, p_year_to)
      and (p_leaid is null or sd.leaid = p_leaid)
      and (p_ncessch is null or sd.ncessch = p_ncessch)
      and (p_state is null or sd.state_location = p_state)
  ),
  ids as (
    select distinct ncessch from enroll
    union
    select distinct ncessch from dir
  )
  select
    i.ncessch,
    coalesce(d_to.leaid, d_from.leaid, e_to.leaid, e_from.leaid) as leaid,
    coalesce(d_to.school_name, d_from.school_name, i.ncessch) as school_name,
    coalesce(e_from.enrollment, 0)::bigint as enrollment_from,
    coalesce(e_to.enrollment, 0)::bigint as enrollment_to,
    (coalesce(e_to.enrollment, 0) - coalesce(e_from.enrollment, 0))::bigint as enrollment_delta,
    case when coalesce(e_from.enrollment, 0) > 0
      then round(((coalesce(e_to.enrollment, 0) - e_from.enrollment)::numeric / e_from.enrollment) * 100, 1)
      else null end as enrollment_pct,
    coalesce(d_from.teachers_fte, 0) as teachers_from,
    coalesce(d_to.teachers_fte, 0) as teachers_to,
    (coalesce(d_to.teachers_fte, 0) - coalesce(d_from.teachers_fte, 0)) as teachers_delta,
    case when coalesce(d_from.teachers_fte, 0) > 0
      then round(((coalesce(d_to.teachers_fte, 0) - d_from.teachers_fte) / d_from.teachers_fte) * 100, 1)
      else null end as teachers_pct
  from ids i
  left join enroll e_from on e_from.ncessch = i.ncessch and e_from.school_year = p_year_from
  left join enroll e_to on e_to.ncessch = i.ncessch and e_to.school_year = p_year_to
  left join dir d_from on d_from.ncessch = i.ncessch and d_from.school_year = p_year_from
  left join dir d_to on d_to.ncessch = i.ncessch and d_to.school_year = p_year_to
  where coalesce(e_from.enrollment, 0) > 0
     or coalesce(e_to.enrollment, 0) > 0
     or coalesce(d_from.teachers_fte, 0) > 0
     or coalesce(d_to.teachers_fte, 0) > 0
  order by i.ncessch;
end;
$$;

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

  -- District scope: prefer district enrollment per year (same as
  -- nces_map_enrollment_by_grade); fall back to school enrollment for years
  -- that have no district grade rows (avoids From=0 when only 2015/2020 LEA
  -- grade tables were synced).
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

grant execute on function public.nces_map_school_metric_change(int, int, text, text, text) to authenticated;
grant execute on function public.nces_map_enrollment_by_grade_change(int, int, text, text) to authenticated;
