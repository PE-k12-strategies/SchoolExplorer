-- Align years_complete with the sync script's definition.
--
-- Previously (010): a district was years_complete only if nces_district_directory
-- had a row for EVERY year in p_years. That falsely flagged LEAs that did not
-- exist in earlier CCD years (new charters, special schools, etc.) even when
-- the sync had finished and stamped sync_school_years.
--
-- Sync --incomplete-only uses: last_synced set AND sync_school_years covers
-- SYNC_CONFIG.schoolYears. Match that here so the map / filter labels agree.
--
-- Run after 010. Safe to re-run.
-- Client passes NCES_CONFIG.schoolYears (e.g. 2015,2020,2021,2022,2023,2024).

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
      sd.last_synced,
      sd.sync_school_years
    from public.nces_sync_districts sd
    where sd.enabled = true
      and sd.state_code is not null
  ),
  year_ok as (
    select d.leaid
    from dist d
    where d.last_synced is not null
      and (
        p_years is null
        or cardinality(p_years) = 0
        or d.sync_school_years @> p_years
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
