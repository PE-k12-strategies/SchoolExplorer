-- FORCE-link admin Auth ↔ public.users. Run entire file in Supabase → SQL Editor.
-- Then sign OUT and sign back IN on the access page.

-- 0) See current state
select 'auth' as src, id::text, email as email_or_name, null::text as role, null::text as status
from auth.users
where lower(email) = lower('k12strategies@perkinseastman.com')
union all
select 'users', id::text, "E_Mail", "Role", approval_status
from public.users
where lower("E_Mail") = lower('k12strategies@perkinseastman.com');

-- 1) Clear any row that already holds this Auth user's id (blocks unique auth_user_id)
update public.users
set auth_user_id = null
where auth_user_id in (
  select id from auth.users
  where lower(email) = lower('k12strategies@perkinseastman.com')
);

-- 2) Link existing public.users row (case-insensitive email)
update public.users u
set
  auth_user_id = au.id,
  "E_Mail" = au.email,
  approval_status = 'approved',
  approved_at = coalesce(u.approved_at, now()),
  approved_by = 'k12strategies@perkinseastman.com',
  "Name" = coalesce(nullif(trim(u."Name"), ''), 'K12 Strategies'),
  "Title" = case
    when lower(coalesce(u."Title", '')) in (
      'untitled', 'associate', 'senior associate', 'associate principal', 'principal'
    ) then lower(u."Title")
    else 'untitled'
  end,
  "Role" = coalesce(nullif(trim(u."Role"), ''), 'Admin')
from auth.users au
where lower(u."E_Mail") = lower('k12strategies@perkinseastman.com')
  and lower(au.email) = lower('k12strategies@perkinseastman.com');

-- 3) Create the row if it still does not exist
insert into public.users (
  "Name", "Title", "E_Mail", "Role", auth_user_id, approval_status, approved_at, approved_by
)
select
  'K12 Strategies',
  'untitled',
  au.email,
  'Admin',
  au.id,
  'approved',
  now(),
  au.email
from auth.users au
where lower(au.email) = lower('k12strategies@perkinseastman.com')
  and not exists (
    select 1 from public.users u
    where lower(u."E_Mail") = lower('k12strategies@perkinseastman.com')
  )
order by au.created_at desc
limit 1;

-- 4) Verify — linked_ok must be true
select
  u.id,
  u."Name",
  u."Title",
  u."E_Mail",
  u."Role",
  u.approval_status,
  u.auth_user_id,
  au.id as auth_id,
  (u.auth_user_id = au.id) as linked_ok
from public.users u
join auth.users au on lower(au.email) = lower(u."E_Mail")
where lower(u."E_Mail") = lower('k12strategies@perkinseastman.com');
