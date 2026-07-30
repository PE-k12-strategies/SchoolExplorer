-- Fix: re-signup after delete didn't show as pending
-- Run in Supabase SQL Editor.

-- 1) Find the person (change the email)
select id, "Name", "E_Mail", approval_status, auth_user_id, created_at
from public.users
where lower("E_Mail") = lower('USER_EMAIL_HERE');

-- 2) Put them back in Pending so they appear on admin.html
update public.users
set
  approval_status = 'pending',
  approved_at = null,
  approved_by = null
where lower("E_Mail") = lower('USER_EMAIL_HERE');

-- 3) Update the signup trigger so this doesn't happen again
-- (same logic as sql/setup.sql handle_new_user)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
  set
    auth_user_id = new.id,
    approval_status = case
      when new.email = 'k12strategies@perkinseastman.com' then 'approved'
      else 'pending'
    end,
    approved_at = null,
    approved_by = null,
    "Name" = coalesce(new.raw_user_meta_data ->> 'name', "Name"),
    "Title" = coalesce(new.raw_user_meta_data ->> 'title', "Title"),
    "Role" = coalesce(new.raw_user_meta_data ->> 'role', "Role")
  where "E_Mail" = new.email
    and auth_user_id is null;

  if not exists (
    select 1 from public.users where auth_user_id = new.id
  ) then
    insert into public.users (
      "Name",
      "Title",
      "E_Mail",
      "Role",
      auth_user_id,
      approval_status
    )
    values (
      coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
      coalesce(new.raw_user_meta_data ->> 'title', 'untitled'),
      new.email,
      coalesce(new.raw_user_meta_data ->> 'role', 'Viewer'),
      new.id,
      case
        when new.email = 'k12strategies@perkinseastman.com' then 'approved'
        else 'pending'
      end
    );
  end if;

  return new;
end;
$$;
