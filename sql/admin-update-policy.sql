-- Ensures admin can update all user fields (identification + access level)
-- Run once in Supabase SQL Editor if edits fail with permission errors

drop policy if exists "Admin can update users" on public.users;
create policy "Admin can update users"
  on public.users for update
  using (
    (auth.jwt() ->> 'email') = 'k12strategies@perkinseastman.com'
  )
  with check (
    (auth.jwt() ->> 'email') = 'k12strategies@perkinseastman.com'
  );
