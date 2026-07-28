-- Multi-state / multi-year NCES support
-- Run after 001 and 002

alter table public.nces_sync_districts
  add column if not exists fips int;

create index if not exists nces_sync_districts_state_idx
  on public.nces_sync_districts (state_code);

create index if not exists nces_district_enrollment_leaid_year_idx
  on public.nces_district_enrollment (leaid, school_year);

create index if not exists nces_school_directory_state_leaid_idx
  on public.nces_school_directory (leaid, school_year);

-- Default Jeffco to multi-year sync windows
update public.nces_sync_districts
set
  sync_school_years = '{2021,2022,2023}',
  sync_finance_years = '{2019,2020,2021}',
  fips = 8,
  state_code = 'CO'
where leaid = '0804800';
