-- Prepare k12strategies row in public.users (if missing)
insert into public.users ("Name", "Title", "E_Mail", "Role", approval_status)
select
  'K12 Strategies',
  'principal',
  'k12strategies@perkinseastman.com',
  'Admin',
  'approved'
where not exists (
  select 1 from public.users where "E_Mail" = 'k12strategies@perkinseastman.com'
);

-- After creating Auth user in Dashboard, run sql/link-admin.sql
