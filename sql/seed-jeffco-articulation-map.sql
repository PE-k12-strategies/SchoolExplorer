-- Jeffco articulation area → school mapping (NOT from NCES)
--
-- NCES / CCD has no articulation area field. Jeffco uses local "articulation areas"
-- (Arvada, Bear Creek, Lakewood, etc.). This table links NCES school IDs to those areas.
--
-- HOW TO USE
-- 1. Get school NCES IDs from nces_school_directory (column ncessch) for leaid 0804800
-- 2. Get area IDs from: select id, area_name from nces_articulation_areas where leaid = '0804800';
-- 3. Insert rows below (or import CSV into nces_school_articulation_map)
--
-- Example — map one school (replace IDs with real values from your tables):
--
-- insert into public.nces_school_articulation_map (ncessch, articulation_area_id)
-- select '080480000725', id from public.nces_articulation_areas
-- where leaid = '0804800' and area_name = 'Arvada'
-- on conflict do nothing;
--
-- Bulk example from a spreadsheet with columns: ncessch, area_name
--
-- insert into public.nces_school_articulation_map (ncessch, articulation_area_id)
-- select v.ncessch, a.id
-- from (values
--   ('080480000725', 'Arvada'),
--   ('080480000696', 'Lakewood')
-- ) as v(ncessch, area_name)
-- join public.nces_articulation_areas a
--   on a.leaid = '0804800' and a.area_name = v.area_name
-- on conflict do nothing;

-- Check mapping coverage for Jeffco
select
  a.area_name,
  count(m.ncessch) as schools_mapped
from public.nces_articulation_areas a
left join public.nces_school_articulation_map m on m.articulation_area_id = a.id
where a.leaid = '0804800'
group by a.area_name
order by a.area_name;
