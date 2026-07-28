-- Fix PL/pgSQL ambiguity: RETURNS TABLE output names (ncessch, leaid, …)
-- collide with column references inside nces_map_school_metric_change.
-- That caused: 400 "column reference ncessch is ambiguous"
-- Safe to re-run.

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

  return query
  with enroll as (
    select
      se.ncessch as sch_id,
      se.leaid as lea_id,
      se.school_year as yr,
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
      sd.ncessch as sch_id,
      sd.leaid as lea_id,
      sd.school_year as yr,
      sd.school_name as sch_name,
      coalesce(sd.teachers_fte, 0) as teachers_fte
    from public.nces_school_directory sd
    where sd.school_year in (p_year_from, p_year_to)
      and (p_leaid is null or sd.leaid = p_leaid)
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
    coalesce(e_from.enrollment, 0)::bigint,
    coalesce(e_to.enrollment, 0)::bigint,
    (coalesce(e_to.enrollment, 0) - coalesce(e_from.enrollment, 0))::bigint,
    case when coalesce(e_from.enrollment, 0) > 0
      then round(((coalesce(e_to.enrollment, 0) - e_from.enrollment)::numeric / e_from.enrollment) * 100, 1)
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
  where coalesce(e_from.enrollment, 0) > 0
     or coalesce(e_to.enrollment, 0) > 0
     or coalesce(d_from.teachers_fte, 0) > 0
     or coalesce(d_to.teachers_fte, 0) > 0
  order by i.sch_id;
end;
$$;

grant execute on function public.nces_map_school_metric_change(int, int, text, text, text) to authenticated;
