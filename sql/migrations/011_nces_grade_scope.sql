-- Enrollment by grade aggregated for a school year, optionally filtered by state.
-- Used by District-wide tab at nationwide / state scope (no LEA selected).
-- Safe to re-run.

drop function if exists public.nces_map_enrollment_by_grade_scope(int, text);

create or replace function public.nces_map_enrollment_by_grade_scope(
  p_year int,
  p_state text default null
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

  return query
  select
    de.grade,
    coalesce(sum(de.enrollment), 0)::bigint as enrollment
  from public.nces_district_enrollment de
  where de.school_year = yr
    and de.race = 99
    and de.sex = 99
    and de.grade between 1 and 12
    and (
      p_state is null
      or exists (
        select 1
        from public.nces_sync_districts d
        where d.leaid = de.leaid
          and d.state_code = p_state
      )
    )
  group by de.grade
  order by de.grade;
end;
$$;

grant execute on function public.nces_map_enrollment_by_grade_scope(int, text) to authenticated;
