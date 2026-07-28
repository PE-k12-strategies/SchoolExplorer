-- Run AFTER creating the admin login in Supabase Auth
-- Dashboard → Authentication → Users → Add user
--   Email: k12strategies@perkinseastman.com
--   Password: (choose one)
--   Auto Confirm User: ON

-- This links your existing public.users row to that Auth account
-- and marks the admin as approved.

update public.users u
set
  auth_user_id = au.id,
  approval_status = 'approved',
  approved_at = now(),
  approved_by = 'k12strategies@perkinseastman.com'
from auth.users au
where u."E_Mail" = 'k12strategies@perkinseastman.com'
  and au.email = 'k12strategies@perkinseastman.com';

-- Verify the link worked (should return 1 row with auth_user_id filled in):
select id, "Name", "Title", "E_Mail", "Role", auth_user_id, approval_status
from public.users
where "E_Mail" = 'k12strategies@perkinseastman.com';
