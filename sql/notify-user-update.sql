-- Email the user when any profile field is changed by an admin
-- Run AFTER deploying notify-user-update Edge Function

create or replace function public.notify_user_on_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  notify_secret text;
  request_id bigint;
  changes jsonb := '[]'::jsonb;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new."E_Mail" is null or new."E_Mail" = '' then
    return new;
  end if;

  if old."Name" is distinct from new."Name" then
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'Name', 'old_value', old."Name", 'new_value', new."Name"
    ));
  end if;

  if old."Title" is distinct from new."Title" then
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'Title', 'old_value', old."Title", 'new_value', new."Title"
    ));
  end if;

  if old."E_Mail" is distinct from new."E_Mail" then
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'Email', 'old_value', old."E_Mail", 'new_value', new."E_Mail"
    ));
  end if;

  if old."Role" is distinct from new."Role" then
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'Role', 'old_value', old."Role", 'new_value', new."Role"
    ));
  end if;

  if old.approval_status is distinct from new.approval_status then
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'Access level', 'old_value', old.approval_status, 'new_value', new.approval_status
    ));
  end if;

  if jsonb_array_length(changes) = 0 then
    return new;
  end if;

  select decrypted_secret
  into notify_secret
  from vault.decrypted_secrets
  where name = 'notify_secret'
  limit 1;

  if notify_secret is null then
    raise warning 'notify_secret not found in vault — profile update email not sent';
    return new;
  end if;

  select net.http_post(
    url := 'https://jmmrsetieidkwycnfvkm.supabase.co/functions/v1/notify-user-update',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notify-secret', notify_secret
    ),
    body := jsonb_build_object(
      'name', new."Name",
      'email', new."E_Mail",
      'updated_by', coalesce(new.approved_by, 'an administrator'),
      'changes', changes
    )
  ) into request_id;

  return new;
end;
$$;

drop trigger if exists on_users_role_change_notify on public.users;
drop trigger if exists on_users_profile_change_notify on public.users;

create trigger on_users_profile_change_notify
  after update on public.users
  for each row
  execute function public.notify_user_on_profile_change();

drop function if exists public.notify_user_on_role_change();
