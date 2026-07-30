-- Paste results if still stuck. Run in Supabase → SQL Editor.

-- A) Auth user(s) for admin email
select id, email, email_confirmed_at, created_at, last_sign_in_at
from auth.users
where lower(email) = lower('k12strategies@perkinseastman.com')
order by created_at desc;

-- B) public.users row(s)
select id, "Name", "Title", "E_Mail", "Role", approval_status, auth_user_id, created_at
from public.users
where lower("E_Mail") = lower('k12strategies@perkinseastman.com');

-- C) Do they match?
select
  au.id as auth_id,
  au.email as auth_email,
  u.id as users_id,
  u."E_Mail" as users_email,
  u.auth_user_id,
  (u.auth_user_id = au.id) as linked_ok,
  u.approval_status
from auth.users au
full outer join public.users u
  on lower(u."E_Mail") = lower(au.email)
where lower(coalesce(au.email, u."E_Mail")) = lower('k12strategies@perkinseastman.com');

-- D) Is link_my_user_profile installed?
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('link_my_user_profile', 'handle_new_user');
