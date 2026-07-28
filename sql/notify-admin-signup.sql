-- Admin email notification when a new user signs up (approval_status = pending)
-- Run AFTER deploying the notify-admin-signup Edge Function (see steps below)

-- Step 1: Enable pg_net (usually already on in Supabase)
create extension if not exists pg_net with schema extensions;

-- Step 2: Store shared secret in Vault (skip if already exists)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notify_secret') then
    perform vault.create_secret(
      'pe-notify-8f3k2m9x7q1w5n4r6t',
      'notify_secret',
      'Shared secret for signup notification edge function'
    );
  end if;
end $$;

-- Step 3: Trigger function — calls Edge Function via HTTP
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

  return new;
end;
$$;

drop trigger if exists on_users_signup_notify on public.users;
create trigger on_users_signup_notify
  after insert on public.users
  for each row
  execute function public.notify_admin_on_signup();

-- Test (optional): check recent pg_net requests after a signup
-- select * from net._http_response order by created desc limit 5;
