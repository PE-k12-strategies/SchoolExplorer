-- NCES / Education Data API tables (Urban Institute CCD)
-- Run in Supabase SQL Editor after sql/setup.sql

-- Districts configured for synchronization.
-- Change leaid here to add another district (see nces-sync/README.md).
create table if not exists public.nces_sync_districts (
  leaid text primary key,
  district_name text not null,
  state_code text not null default 'CO',
  enabled boolean not null default true,
  sync_school_years int[] not null default '{2023}',
  sync_finance_years int[] not null default '{2020}',
  notes text,
  last_synced timestamptz
);

insert into public.nces_sync_districts (leaid, district_name, state_code, notes)
values (
  '0804800',
  'Jefferson County School District No. R-1',
  'CO',
  'Jefferson County Public Schools (Jeffco), Colorado. NCES LEA ID 0804800.'
)
on conflict (leaid) do update set
  district_name = excluded.district_name,
  notes = excluded.notes;

-- Jeffco articulation areas (local; not in NCES API — map schools manually)
create table if not exists public.nces_articulation_areas (
  id bigint generated always as identity primary key,
  leaid text not null references public.nces_sync_districts (leaid) on delete cascade,
  area_name text not null,
  description text,
  unique (leaid, area_name)
);

insert into public.nces_articulation_areas (leaid, area_name)
values
  ('0804800', 'Arvada'),
  ('0804800', 'Bear Creek'),
  ('0804800', 'Chatfield'),
  ('0804800', 'Columbine'),
  ('0804800', 'Conifer'),
  ('0804800', 'Dakota Ridge'),
  ('0804800', 'Evergreen'),
  ('0804800', 'Golden'),
  ('0804800', 'Green Mountain'),
  ('0804800', 'Jefferson'),
  ('0804800', 'Lakewood'),
  ('0804800', 'Mt. View'),
  ('0804800', 'Pomona'),
  ('0804800', 'Ralston Valley'),
  ('0804800', 'Standley Lake'),
  ('0804800', 'Wheat Ridge')
on conflict (leaid, area_name) do nothing;

create table if not exists public.nces_school_articulation_map (
  ncessch text not null,
  articulation_area_id bigint not null references public.nces_articulation_areas (id) on delete cascade,
  last_synced timestamptz not null default now(),
  primary key (ncessch, articulation_area_id)
);

create table if not exists public.nces_district_directory (
  leaid text not null,
  school_year int not null,
  lea_name text,
  state_leaid text,
  fips int,
  city_location text,
  state_location text,
  county_name text,
  phone text,
  number_of_schools int,
  enrollment int,
  teachers_total_fte numeric,
  staff_total_fte numeric,
  raw_data jsonb not null default '{}'::jsonb,
  last_synced timestamptz not null default now(),
  primary key (leaid, school_year)
);

create table if not exists public.nces_school_directory (
  ncessch text not null,
  leaid text not null,
  school_year int not null,
  school_name text,
  school_level int,
  charter int,
  lowest_grade_offered int,
  highest_grade_offered int,
  teachers_fte numeric,
  city_location text,
  state_location text,
  raw_data jsonb not null default '{}'::jsonb,
  last_synced timestamptz not null default now(),
  primary key (ncessch, school_year)
);

create index if not exists nces_school_directory_leaid_idx
  on public.nces_school_directory (leaid, school_year);

create table if not exists public.nces_school_enrollment (
  ncessch text not null,
  leaid text not null,
  school_year int not null,
  grade int not null,
  race int not null default 99,
  sex int not null default 99,
  enrollment int,
  raw_data jsonb not null default '{}'::jsonb,
  last_synced timestamptz not null default now(),
  primary key (ncessch, school_year, grade, race, sex)
);

create index if not exists nces_school_enrollment_leaid_idx
  on public.nces_school_enrollment (leaid, school_year);

create table if not exists public.nces_district_enrollment (
  leaid text not null,
  school_year int not null,
  grade int not null,
  race int not null default 99,
  sex int not null default 99,
  enrollment int,
  raw_data jsonb not null default '{}'::jsonb,
  last_synced timestamptz not null default now(),
  primary key (leaid, school_year, grade, race, sex)
);

create table if not exists public.nces_district_finance (
  leaid text not null,
  fiscal_year int not null,
  rev_total numeric,
  exp_total numeric,
  enrollment_fall_school int,
  salaries_total numeric,
  raw_data jsonb not null default '{}'::jsonb,
  last_synced timestamptz not null default now(),
  primary key (leaid, fiscal_year)
);

-- Staff FTE counts from CCD district directory (no separate CCD staff endpoint)
create table if not exists public.nces_district_staff (
  leaid text not null,
  school_year int not null,
  teachers_total_fte numeric,
  teachers_prek_fte numeric,
  teachers_kindergarten_fte numeric,
  teachers_elementary_fte numeric,
  teachers_secondary_fte numeric,
  instructional_aides_fte numeric,
  guidance_counselors_total_fte numeric,
  school_administrators_fte numeric,
  lea_administrators_fte numeric,
  staff_total_fte numeric,
  raw_data jsonb not null default '{}'::jsonb,
  last_synced timestamptz not null default now(),
  primary key (leaid, school_year)
);

create table if not exists public.nces_sync_log (
  id bigint generated always as identity primary key,
  leaid text,
  dataset text not null,
  school_year int,
  status text not null check (status in ('started', 'success', 'error')),
  records_upserted int not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists nces_sync_log_leaid_idx on public.nces_sync_log (leaid, started_at desc);
