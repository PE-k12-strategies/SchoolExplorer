-- Per-state sync completeness for the map's "Data completeness" filter.
-- SUPERSEDED by 010_nces_state_year_completeness.sql (adds p_years / years_complete).
-- Keeping this file so older install notes still work; 010 replaces the function.

create or replace function public.nces_state_completeness()
returns table (
  state_code text,
  total int,
  synced int
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
  select
    sd.state_code,
    count(*)::int as total,
    count(sd.last_synced)::int as synced
  from public.nces_sync_districts sd
  where sd.enabled = true
    and sd.state_code is not null
  group by sd.state_code;
end;
$$;

grant execute on function public.nces_state_completeness() to authenticated;
