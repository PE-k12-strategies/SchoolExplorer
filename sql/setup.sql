-- Run this in Supabase SQL Editor for project jmmrsetieidkwycnfvkm
-- Works with your existing public.users table (no password column needed)

-- 1. Add auth link + approval columns to your existing table
alter table public.users
  add column if not exists auth_user_id uuid unique references auth.users (id) on delete cascade;

alter table public.users
  add column if not exists approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected'));

alter table public.users
  add column if not exists approved_at timestamptz;

alter table public.users
  add column if not exists approved_by text;

create index if not exists users_approval_status_idx
  on public.users (approval_status);

create index if not exists users_auth_user_id_idx
  on public.users (auth_user_id);

-- 2. Row Level Security
alter table public.users enable row level security;

drop policy if exists "Users can view own row" on public.users;
create policy "Users can view own row"
  on public.users for select
  using (auth_user_id = auth.uid());

drop policy if exists "Admin can view all users" on public.users;
create policy "Admin can view all users"
  on public.users for select
  using (
    (auth.jwt() ->> 'email') = 'k12strategies@perkinseastman.com'
  );

drop policy if exists "Admin can update users" on public.users;
create policy "Admin can update users"
  on public.users for update
  using (
    (auth.jwt() ->> 'email') = 'k12strategies@perkinseastman.com'
  )
  with check (
    (auth.jwt() ->> 'email') = 'k12strategies@perkinseastman.com'
  );

-- 3) When someone signs up via Supabase Auth, link or create their users row
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Re-link an orphaned profile row (same email, no auth user).
  -- Always reset to pending so a re-signup shows up for admin approval again.
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

  -- Create a new row if none is linked yet
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. Helper for protecting dashboard tables later
create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where auth_user_id = auth.uid()
      and approval_status = 'approved'
  );
$$;

-- Example for future dashboard tables:
-- create policy "Approved users only" on public.your_table
--   for all using (public.is_approved());
