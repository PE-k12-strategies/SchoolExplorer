-- RLS for NCES tables — approved dashboard users read; admin manages

alter table public.nces_sync_districts enable row level security;
alter table public.nces_articulation_areas enable row level security;
alter table public.nces_school_articulation_map enable row level security;
alter table public.nces_district_directory enable row level security;
alter table public.nces_school_directory enable row level security;
alter table public.nces_school_enrollment enable row level security;
alter table public.nces_district_enrollment enable row level security;
alter table public.nces_district_finance enable row level security;
alter table public.nces_district_staff enable row level security;
alter table public.nces_sync_log enable row level security;

-- Approved users: read
do $$
declare
  t text;
begin
  foreach t in array array[
    'nces_sync_districts',
    'nces_articulation_areas',
    'nces_school_articulation_map',
    'nces_district_directory',
    'nces_school_directory',
    'nces_school_enrollment',
    'nces_district_enrollment',
    'nces_district_finance',
    'nces_district_staff'
  ]
  loop
    execute format('drop policy if exists "Approved users read %1$s" on public.%1$s', t);
    execute format(
      'create policy "Approved users read %1$s" on public.%1$s for select using (public.is_approved())',
      t
    );
  end loop;
end $$;

-- Admin: full access on data tables
do $$
declare
  t text;
begin
  foreach t in array array[
    'nces_sync_districts',
    'nces_articulation_areas',
    'nces_school_articulation_map',
    'nces_district_directory',
    'nces_school_directory',
    'nces_school_enrollment',
    'nces_district_enrollment',
    'nces_district_finance',
    'nces_district_staff',
    'nces_sync_log'
  ]
  loop
    execute format('drop policy if exists "Admin manages %1$s" on public.%1$s', t);
    execute format(
      'create policy "Admin manages %1$s" on public.%1$s for all
        using ((auth.jwt() ->> ''email'') = ''k12strategies@perkinseastman.com'')
        with check ((auth.jwt() ->> ''email'') = ''k12strategies@perkinseastman.com'')',
      t
    );
  end loop;
end $$;

-- Sync log: approved users can read (see last sync status on dashboard)
drop policy if exists "Approved users read nces_sync_log" on public.nces_sync_log;
create policy "Approved users read nces_sync_log"
  on public.nces_sync_log for select
  using (public.is_approved());
