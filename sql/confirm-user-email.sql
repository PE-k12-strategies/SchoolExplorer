-- Manually confirm a signup when Auth email links point at localhost
-- and Email Templates / Site URL cannot be edited.
-- Run in Supabase → SQL Editor.

-- 1) Find the user
select id, email, email_confirmed_at, created_at, last_sign_in_at
from auth.users
where lower(email) = lower('a.basler@perkinseastman.com');

-- 2) Confirm their email
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where lower(email) = lower('a.basler@perkinseastman.com');

-- 3) Verify
select id, email, email_confirmed_at
from auth.users
where lower(email) = lower('a.basler@perkinseastman.com');

-- 4) They still need approval in public.users (admin.html), if pending:
-- select "Name", "E_Mail", approval_status from public.users
-- where lower("E_Mail") = lower('a.basler@perkinseastman.com');
