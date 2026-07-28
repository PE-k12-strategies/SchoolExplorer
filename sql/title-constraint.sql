-- Restrict Title to allowed values. Run in Supabase SQL Editor.

-- Fix any existing rows that do not match (e.g. "Pending", "Admin")
update public.users
set "Title" = 'untitled'
where "Title" is null
   or "Title" not in (
     'untitled',
     'associate',
     'senior associate',
     'associate principal',
     'principal'
   );

alter table public.users drop constraint if exists users_title_check;

alter table public.users
  add constraint users_title_check check (
    "Title" in (
      'untitled',
      'associate',
      'senior associate',
      'associate principal',
      'principal'
    )
  );
