-- State completeness that includes required CCD school years.
-- A district is "years_complete" only if it has last_synced AND a
-- nces_district_directory row for every year in p_years.
-- Run after 006. Safe to re-run.
-- Client passes NCES_CONFIG.schoolYears (e.g. 2015,2020,2021,2022,2023,2024).

drop function if exists public.nces_state_completeness();
drop function if exists public.nces_state_completeness(int[]);

create or replace function public.nces_state_completeness(p_years int[] default null)
returns table (
  state_code text,
  total int,
  synced int,
  years_complete int
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

  return query
  with dist as (
    select
      sd.leaid,
      sd.state_code,
      sd.last_synced
    from public.nces_sync_districts sd
    where sd.enabled = true
      and sd.state_code is not null
  ),
  year_ok as (
    select d.leaid
    from dist d
    where p_years is null
       or cardinality(p_years) = 0
       or (
         d.last_synced is not null
         and not exists (
           select 1
           from unnest(p_years) as y(yr)
           where not exists (
             select 1
             from public.nces_district_directory dd
             where dd.leaid = d.leaid
               and dd.school_year = y.yr
           )
         )
       )
  )
  select
    d.state_code,
    count(*)::int as total,
    count(d.last_synced)::int as synced,
    count(y.leaid)::int as years_complete
  from dist d
  left join year_ok y on y.leaid = d.leaid
  group by d.state_code
  order by d.state_code;
end;
$$;

grant execute on function public.nces_state_completeness(int[]) to authenticated;
