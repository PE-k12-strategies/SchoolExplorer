-- Metric change (from year → to year) for map choropleth.
-- Enrollment, teachers FTE, staff FTE from nces_district_directory.
-- Run after 004/005. Safe to re-run (replaces prior 007 functions).

drop function if exists public.nces_map_enrollment_change(int, int, text);
drop function if exists public.nces_map_state_enrollment_change(int, int);
drop function if exists public.nces_map_metric_change(int, int, text);
drop function if exists public.nces_map_state_metric_change(int, int);

create or replace function public.nces_map_metric_change(
  p_year_from int,
  p_year_to int,
  p_state text default null
)
returns table (
  leaid text,
  district_name text,
  state_code text,
  enrollment_from int,
  enrollment_to int,
  enrollment_delta int,
  enrollment_pct numeric,
  teachers_from numeric,
  teachers_to numeric,
  teachers_delta numeric,
  teachers_pct numeric,
  staff_from numeric,
  staff_to numeric,
  staff_delta numeric,
  staff_pct numeric
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
  with from_y as (
    select
      dd.leaid,
      dd.lea_name,
      dd.state_location,
      coalesce(dd.enrollment, 0) as enrollment,
      coalesce(dd.teachers_total_fte, 0) as teachers_fte,
      coalesce(dd.staff_total_fte, 0) as staff_fte
    from public.nces_district_directory dd
    where dd.school_year = p_year_from
      and (p_state is null or dd.state_location = p_state)
  ),
  to_y as (
    select
      dd.leaid,
      dd.lea_name,
      dd.state_location,
      coalesce(dd.enrollment, 0) as enrollment,
      coalesce(dd.teachers_total_fte, 0) as teachers_fte,
      coalesce(dd.staff_total_fte, 0) as staff_fte
    from public.nces_district_directory dd
    where dd.school_year = p_year_to
      and (p_state is null or dd.state_location = p_state)
  ),
  joined as (
    select
      coalesce(f.leaid, t.leaid) as leaid,
      coalesce(nullif(t.lea_name, ''), nullif(f.lea_name, ''), coalesce(f.leaid, t.leaid)) as district_name,
      coalesce(f.state_location, t.state_location) as state_code,
      coalesce(f.enrollment, 0) as enrollment_from,
      coalesce(t.enrollment, 0) as enrollment_to,
      coalesce(f.teachers_fte, 0) as teachers_from,
      coalesce(t.teachers_fte, 0) as teachers_to,
      coalesce(f.staff_fte, 0) as staff_from,
      coalesce(t.staff_fte, 0) as staff_to
    from from_y f
    full outer join to_y t on f.leaid = t.leaid
  )
  select
    j.leaid,
    j.district_name,
    j.state_code,
    j.enrollment_from,
    j.enrollment_to,
    (j.enrollment_to - j.enrollment_from)::int as enrollment_delta,
    case when j.enrollment_from > 0
      then round(((j.enrollment_to - j.enrollment_from)::numeric / j.enrollment_from) * 100, 1)
      else null end as enrollment_pct,
    j.teachers_from,
    j.teachers_to,
    (j.teachers_to - j.teachers_from) as teachers_delta,
    case when j.teachers_from > 0
      then round(((j.teachers_to - j.teachers_from) / j.teachers_from) * 100, 1)
      else null end as teachers_pct,
    j.staff_from,
    j.staff_to,
    (j.staff_to - j.staff_from) as staff_delta,
    case when j.staff_from > 0
      then round(((j.staff_to - j.staff_from) / j.staff_from) * 100, 1)
      else null end as staff_pct
  from joined j
  where j.leaid is not null
    and (
      j.enrollment_from > 0 or j.enrollment_to > 0
      or j.teachers_from > 0 or j.teachers_to > 0
      or j.staff_from > 0 or j.staff_to > 0
    )
  order by j.leaid;
end;
$$;

-- Keep old name as a thin wrapper so older clients still work.
create or replace function public.nces_map_enrollment_change(
  p_year_from int,
  p_year_to int,
  p_state text default null
)
returns table (
  leaid text,
  district_name text,
  state_code text,
  enrollment_from int,
  enrollment_to int,
  enrollment_delta int,
  enrollment_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.leaid,
    m.district_name,
    m.state_code,
    m.enrollment_from,
    m.enrollment_to,
    m.enrollment_delta,
    m.enrollment_pct
  from public.nces_map_metric_change(p_year_from, p_year_to, p_state) m;
$$;

create or replace function public.nces_map_state_metric_change(
  p_year_from int,
  p_year_to int
)
returns table (
  state_code text,
  districts int,
  enrollment_from bigint,
  enrollment_to bigint,
  enrollment_delta bigint,
  enrollment_pct numeric,
  teachers_from numeric,
  teachers_to numeric,
  teachers_delta numeric,
  teachers_pct numeric,
  staff_from numeric,
  staff_to numeric,
  staff_delta numeric,
  staff_pct numeric
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
  select
    d.state_code,
    count(*)::int as districts,
    coalesce(sum(d.enrollment_from), 0)::bigint,
    coalesce(sum(d.enrollment_to), 0)::bigint,
    coalesce(sum(d.enrollment_delta), 0)::bigint,
    case when coalesce(sum(d.enrollment_from), 0) > 0
      then round((sum(d.enrollment_delta)::numeric / sum(d.enrollment_from)) * 100, 1)
      else null end,
    coalesce(sum(d.teachers_from), 0),
    coalesce(sum(d.teachers_to), 0),
    coalesce(sum(d.teachers_delta), 0),
    case when coalesce(sum(d.teachers_from), 0) > 0
      then round((sum(d.teachers_delta) / sum(d.teachers_from)) * 100, 1)
      else null end,
    coalesce(sum(d.staff_from), 0),
    coalesce(sum(d.staff_to), 0),
    coalesce(sum(d.staff_delta), 0),
    case when coalesce(sum(d.staff_from), 0) > 0
      then round((sum(d.staff_delta) / sum(d.staff_from)) * 100, 1)
      else null end
  from public.nces_map_metric_change(p_year_from, p_year_to, null) d
  where d.state_code is not null
  group by d.state_code;
end;
$$;

create or replace function public.nces_map_state_enrollment_change(
  p_year_from int,
  p_year_to int
)
returns table (
  state_code text,
  districts int,
  enrollment_from bigint,
  enrollment_to bigint,
  enrollment_delta bigint,
  enrollment_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.state_code,
    s.districts,
    s.enrollment_from,
    s.enrollment_to,
    s.enrollment_delta,
    s.enrollment_pct
  from public.nces_map_state_metric_change(p_year_from, p_year_to) s;
$$;

-- School-level enrollment (+ teachers FTE) change for map markers / detail panel.
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

-- Per-grade enrollment change for school/district detail panels.
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
      and (
        (p_ncessch is not null and p_ncessch <> '' and se.ncessch = p_ncessch)
        or (
          (p_ncessch is null or p_ncessch = '')
          and p_leaid is not null and p_leaid <> ''
          and se.leaid = p_leaid
        )
      )
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
end;
$$;

grant execute on function public.nces_map_metric_change(int, int, text) to authenticated;
grant execute on function public.nces_map_state_metric_change(int, int) to authenticated;
grant execute on function public.nces_map_enrollment_change(int, int, text) to authenticated;
grant execute on function public.nces_map_state_enrollment_change(int, int) to authenticated;
grant execute on function public.nces_map_school_metric_change(int, int, text, text, text) to authenticated;
grant execute on function public.nces_map_enrollment_by_grade_change(int, int, text, text) to authenticated;
