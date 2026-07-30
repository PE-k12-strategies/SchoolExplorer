-- Fix "Database error saving new user" + orphaned profiles (signed in, blank Name/Status).
-- Run in Supabase → SQL Editor.

-- ---------------------------------------------------------------------------
-- A) Repair a specific person (edit the email in ALL places below)
-- ---------------------------------------------------------------------------
-- 1) Inspect
select id, email, email_confirmed_at, created_at
from auth.users
where lower(email) = lower('USER_EMAIL_HERE');

select id, "Name", "E_Mail", "Title", "Role", approval_status, auth_user_id
from public.users
where lower("E_Mail") = lower('USER_EMAIL_HERE');

-- 2a) If a public.users row already exists: link it to the latest Auth user
update public.users u
set
  auth_user_id = au.id,
  "E_Mail" = au.email,
  "Title" = case
    when lower(coalesce(u."Title", '')) in (
      'untitled', 'associate', 'senior associate', 'associate principal', 'principal'
    ) then lower(u."Title")
    else 'untitled'
  end
from (
  select id, email
  from auth.users
  where lower(email) = lower('USER_EMAIL_HERE')
  order by created_at desc
  limit 1
) au
where lower(u."E_Mail") = lower('USER_EMAIL_HERE');

-- 2b) If no public.users row exists yet: create a pending one
insert into public.users (
  "Name", "Title", "E_Mail", "Role", auth_user_id, approval_status
)
select
  coalesce(au.raw_user_meta_data ->> 'name', split_part(au.email, '@', 1)),
  case
    when lower(coalesce(au.raw_user_meta_data ->> 'title', '')) in (
      'untitled', 'associate', 'senior associate', 'associate principal', 'principal'
    ) then lower(au.raw_user_meta_data ->> 'title')
    else 'untitled'
  end,
  au.email,
  case
    when coalesce(au.raw_user_meta_data ->> 'role', '') in ('Viewer', 'Editor', 'Admin')
      then au.raw_user_meta_data ->> 'role'
    else 'Viewer'
  end,
  au.id,
  'pending'
from auth.users au
where lower(au.email) = lower('USER_EMAIL_HERE')
  and not exists (
    select 1 from public.users u where lower(u."E_Mail") = lower(au.email)
  )
order by au.created_at desc
limit 1;

-- 3) Approve (or do it in admin.html — then Devin signs in again and lands on nces.html):
-- update public.users
-- set approval_status = 'approved', approved_at = now(), approved_by = 'k12strategies@perkinseastman.com'
-- where lower("E_Mail") = lower('USER_EMAIL_HERE');


-- ---------------------------------------------------------------------------
-- B) Hardened signup trigger (prevents Auth insert from failing)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_role text;
  v_name text;
begin
  v_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), '');
  v_title := lower(nullif(trim(coalesce(new.raw_user_meta_data ->> 'title', '')), ''));
  v_role := nullif(trim(coalesce(new.raw_user_meta_data ->> 'role', '')), '');

  if v_title is null or v_title not in (
    'untitled', 'associate', 'senior associate', 'associate principal', 'principal'
  ) then
    v_title := 'untitled';
  end if;

  if v_role is null or v_role not in ('Viewer', 'Editor', 'Admin') then
    v_role := 'Viewer';
  end if;

  if v_name is null then
    v_name := split_part(new.email, '@', 1);
  end if;

  -- Re-link one matching row (case-insensitive), including stale auth ids.
  update public.users
  set
    auth_user_id = new.id,
    approval_status = case
      when lower(new.email) = lower('k12strategies@perkinseastman.com') then 'approved'
      else 'pending'
    end,
    approved_at = case
      when lower(new.email) = lower('k12strategies@perkinseastman.com') then now()
      else null
    end,
    approved_by = case
      when lower(new.email) = lower('k12strategies@perkinseastman.com') then new.email
      else null
    end,
    "Name" = coalesce(v_name, "Name"),
    "Title" = v_title,
    "Role" = v_role,
    "E_Mail" = new.email
  where id = (
    select u.id
    from public.users u
    where lower(u."E_Mail") = lower(new.email)
    order by
      (u.auth_user_id is not distinct from new.id) desc,
      (u.auth_user_id is null) desc,
      u.id
    limit 1
  );

  if not found then
    insert into public.users (
      "Name", "Title", "E_Mail", "Role", auth_user_id, approval_status, approved_at, approved_by
    )
    values (
      v_name,
      v_title,
      new.email,
      v_role,
      new.id,
      case
        when lower(new.email) = lower('k12strategies@perkinseastman.com') then 'approved'
        else 'pending'
      end,
      case
        when lower(new.email) = lower('k12strategies@perkinseastman.com') then now()
        else null
      end,
      case
        when lower(new.email) = lower('k12strategies@perkinseastman.com') then new.email
        else null
      end
    );
  end if;

  return new;
exception
  when others then
    -- Never block Auth signup; log and continue. Profile can be repaired via SQL / link RPC.
    raise warning 'handle_new_user failed for %: %', new.email, sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- C) Never let admin-notify HTTP failure roll back the users insert
-- ---------------------------------------------------------------------------
create or replace function public.notify_admin_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  notify_secret text;
  request_id bigint;
begin
  if new.approval_status <> 'pending' then
    return new;
  end if;

  begin
    select decrypted_secret
    into notify_secret
    from vault.decrypted_secrets
    where name = 'notify_secret'
    limit 1;

    if notify_secret is null then
      raise warning 'notify_secret not found in vault — admin email not sent';
      return new;
    end if;

    select net.http_post(
      url := 'https://jmmrsetieidkwycnfvkm.supabase.co/functions/v1/notify-admin-signup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-notify-secret', notify_secret
      ),
      body := jsonb_build_object(
        'name', new."Name",
        'email', new."E_Mail",
        'title', new."Title",
        'role', new."Role",
        'user_id', new.id
      )
    ) into request_id;
  exception
    when others then
      raise warning 'notify_admin_on_signup failed: %', sqlerrm;
  end;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- D) Let a signed-in user claim their pending row by email (self-heal)
-- ---------------------------------------------------------------------------
create or replace function public.link_my_user_profile()
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  em text := auth.jwt() ->> 'email';
  row public.users;
begin
  if uid is null or em is null then
    raise exception 'Not signed in';
  end if;

  update public.users
  set
    auth_user_id = uid,
    "E_Mail" = em
  where id = (
    select u.id
    from public.users u
    where lower(u."E_Mail") = lower(em)
      and (u.auth_user_id is null or u.auth_user_id = uid)
    order by u.id
    limit 1
  )
  returning * into row;

  if row.id is null then
    select * into row from public.users where auth_user_id = uid limit 1;
  end if;

  if row.id is null then
    insert into public.users (
      "Name", "Title", "E_Mail", "Role", auth_user_id, approval_status
    ) values (
      split_part(em, '@', 1),
      'untitled',
      em,
      'Viewer',
      uid,
      case when lower(em) = lower('k12strategies@perkinseastman.com') then 'approved' else 'pending' end
    )
    returning * into row;
  end if;

  return row;
end;
$$;

grant execute on function public.link_my_user_profile() to authenticated;
