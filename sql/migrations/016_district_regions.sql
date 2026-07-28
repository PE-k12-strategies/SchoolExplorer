-- 016: District planning regions (local; not in NCES)
-- Montgomery County Public Schools (LEA 2400480) has 6 regions above articulation areas.
-- Geometry is approximate GeoJSON for map overlay + school point-in-polygon filtering.
-- Run in Supabase SQL Editor after prior NCES migrations.

-- Ensure MCPS exists in the sync roster (FK target).
insert into public.nces_sync_districts (leaid, district_name, state_code, notes, sync_school_years, sync_finance_years)
values (
  '2400480',
  'Montgomery County Public Schools',
  'MD',
  'MCPS Maryland. Local 6-region planning model + HS articulation clusters (not in NCES).',
  '{2015,2020,2021,2022,2023,2024}',
  '{2019,2020,2021}'
)
on conflict (leaid) do update set
  district_name = excluded.district_name,
  state_code = excluded.state_code,
  notes = excluded.notes;

create table if not exists public.nces_district_regions (
  id bigint generated always as identity primary key,
  leaid text not null references public.nces_sync_districts (leaid) on delete cascade,
  region_code int not null,
  region_name text not null,
  color text,
  geom_geojson jsonb,
  unique (leaid, region_code)
);

alter table public.nces_articulation_areas
  add column if not exists region_id bigint references public.nces_district_regions (id) on delete set null;

create index if not exists nces_articulation_areas_region_idx
  on public.nces_articulation_areas (region_id);

-- Seed MCPS regions (geometry mirrors js/mcps-regions.js; hand-tuned via map editor).
insert into public.nces_district_regions (leaid, region_code, region_name, color, geom_geojson)
values
  ('2400480', 1, 'Region 1', '#f9a8d4',
   '{"type":"Polygon","coordinates":[[[-77.14943588990819,38.96511433580332],[-77.12,38.935],[-77.04093640952296,38.99541676415535],[-77.00191721756595,38.966153403087446],[-76.9863348697812,38.977232568957334],[-76.98420395042565,38.98696423785145],[-76.9907321286751,38.992325312512605],[-76.95396284897497,39.039853068294434],[-76.96,39.055],[-76.99,39.085],[-77.02,39.095],[-77.055,39.09],[-77.09,39.07],[-77.115,39.04],[-77.125,39.01],[-77.14,38.98],[-77.14943588990819,38.96511433580332]]]}'::jsonb),
  ('2400480', 2, 'Region 2', '#e7d5b8',
   '{"type":"Polygon","coordinates":[[[-77.055,39.09],[-77.02,39.095],[-76.99,39.085],[-76.96,39.055],[-76.95396271729912,39.04063191658301],[-76.9449375304639,39.05413109372958],[-76.90361767025693,39.11423928125757],[-76.90727093467369,39.11809413665972],[-76.88915074316549,39.13090434671176],[-76.90697867352054,39.12546312617127],[-76.91545424696783,39.12716355274583],[-76.92833154704202,39.13805208555232],[-76.946637362316,39.12941138805169],[-76.95848647530295,39.13419967624512],[-76.95110738697592,39.14542610970685],[-76.97544418790119,39.149663072637594],[-76.97324454492119,39.16215241212791],[-77.00095147982061,39.16985068364394],[-76.9975260418093,39.174377236531285],[-77.00515542647169,39.17624812661782],[-76.9990052082233,39.17793792003681],[-77.00842516275603,39.18180015249044],[-77.00429906696883,39.19211851395815],[-77.01231770595068,39.19519562673648],[-77.00974192459653,39.206460615641134],[-77.03313806330411,39.221074685211306],[-77.04618871957271,39.23810424501781],[-77.06026584581788,39.240017038587354],[-77.06545215548718,39.250536470947594],[-77.08971825473616,39.232199366217145],[-77.06,39.18],[-77.045,39.14],[-77.055,39.09]]]}'::jsonb),
  ('2400480', 3, 'Region 3', '#d4d4d8',
   '{"type":"Polygon","coordinates":[[[-77.14979204960385,38.96414509346292],[-77.14,38.98],[-77.125,39.01],[-77.115,39.04],[-77.09,39.07],[-77.055,39.09],[-77.05,39.11],[-77.09,39.105],[-77.125,39.1],[-77.14,39.07],[-77.155,39.04],[-77.15,39],[-77.14979204960385,38.96414509346292]]]}'::jsonb),
  ('2400480', 4, 'Region 4', '#fde047',
   '{"type":"Polygon","coordinates":[[[-77.14979204960385,38.964560484661035],[-77.15,39],[-77.155,39.04],[-77.14,39.07],[-77.125,39.1],[-77.17,39.115],[-77.2,39.12],[-77.24,39.11],[-77.28727478801439,39.041792149760425],[-77.27046302299367,39.03303541826335],[-77.24672167216669,39.025550286182835],[-77.24539275678255,39.017861986869775],[-77.25562189715025,39.001510896639076],[-77.24524662620563,38.98277062567291],[-77.23530974699172,38.97618195780916],[-77.23,38.98],[-77.22351710648611,38.97189866088101],[-77.19716128904986,38.96691432211054],[-77.14979204960385,38.964560484661035]]]}'::jsonb),
  ('2400480', 5, 'Region 5', '#c4b5fd',
   '{"type":"Polygon","coordinates":[[[-77.045,39.14],[-77.05,39.11],[-77.09,39.105],[-77.125,39.1],[-77.17,39.115],[-77.21,39.13],[-77.23,39.16],[-77.22,39.21],[-77.18,39.25],[-77.12589736074482,39.24854476258136],[-77.09022074231962,39.23297780478515],[-77.06,39.18],[-77.045,39.14]]]}'::jsonb),
  ('2400480', 6, 'Region 6', '#86efac',
   '{"type":"Polygon","coordinates":[[[-77.24,39.11],[-77.2,39.12],[-77.21,39.13],[-77.23,39.16],[-77.22,39.21],[-77.18,39.25],[-77.1263998483283,39.24815563073864],[-77.08821079198577,39.23181014369479],[-77.06693395824993,39.25015397377743],[-77.08245731049973,39.26041550613252],[-77.13381509793489,39.27073282687246],[-77.13973254689662,39.29219442365144],[-77.17087662790631,39.313744955419594],[-77.18734705536355,39.33829983518609],[-77.18405296987228,39.3452477641257],[-77.16728361333452,39.35384061283784],[-77.45839456276195,39.221149192353124],[-77.4741289876706,39.20799878464564],[-77.47855223281182,39.189526590824926],[-77.5109893638502,39.17790756912089],[-77.52770540613552,39.14653197003855],[-77.52081879749814,39.121690119537476],[-77.48617004388915,39.108915831476565],[-77.46126795760169,39.07547195714423],[-77.38424668202089,39.0614653123709],[-77.34113348945499,39.062247567257714],[-77.31,39.055],[-77.2871289357563,39.04222699064988],[-77.24,39.11]]]}'::jsonb)
on conflict (leaid, region_code) do update set
  region_name = excluded.region_name,
  color = excluded.color,
  geom_geojson = excluded.geom_geojson;

-- Articulation areas (HS clusters) under each region.
insert into public.nces_articulation_areas (leaid, area_name, region_id)
select v.leaid, v.area_name, r.id
from (values
  ('2400480', 'Walt Whitman', 1),
  ('2400480', 'Bethesda-Chevy Chase', 1),
  ('2400480', 'Albert Einstein', 1),
  ('2400480', 'Wheaton', 1),
  ('2400480', 'John F. Kennedy', 1),
  ('2400480', 'Northwood', 1),
  ('2400480', 'Montgomery Blair', 1),
  ('2400480', 'Sherwood', 2),
  ('2400480', 'James Hubert Blake', 2),
  ('2400480', 'Springbrook', 2),
  ('2400480', 'Paint Branch', 2),
  ('2400480', 'Rockville', 3),
  ('2400480', 'Walter Johnson', 3),
  ('2400480', 'Charles W. Woodward', 3),
  ('2400480', 'Thomas S. Wootton', 4),
  ('2400480', 'Richard Montgomery', 4),
  ('2400480', 'Winston Churchill', 4),
  ('2400480', 'Watkins Mill', 5),
  ('2400480', 'Gaithersburg', 5),
  ('2400480', 'Col. Zadok Magruder', 5),
  ('2400480', 'Poolesville', 6),
  ('2400480', 'Damascus', 6),
  ('2400480', 'Clarksburg', 6),
  ('2400480', 'Seneca Valley', 6),
  ('2400480', 'Northwest', 6),
  ('2400480', 'Quince Orchard', 6)
) as v(leaid, area_name, region_code)
join public.nces_district_regions r
  on r.leaid = v.leaid and r.region_code = v.region_code
on conflict (leaid, area_name) do update set
  region_id = excluded.region_id;

alter table public.nces_district_regions enable row level security;

drop policy if exists "Approved users read nces_district_regions" on public.nces_district_regions;
create policy "Approved users read nces_district_regions"
  on public.nces_district_regions for select
  using (public.is_approved());

drop policy if exists "Admin manages nces_district_regions" on public.nces_district_regions;
create policy "Admin manages nces_district_regions"
  on public.nces_district_regions for all
  using ((auth.jwt() ->> 'email') = 'k12strategies@perkinseastman.com')
  with check ((auth.jwt() ->> 'email') = 'k12strategies@perkinseastman.com');

comment on table public.nces_district_regions is
  'Local planning regions above articulation areas (e.g. MCPS 6 regions). Not in NCES CCD.';
