-- ============================================================================
-- First admin creation (run AFTER creating the user in Supabase Auth).
--
-- 1. Supabase Dashboard -> Authentication -> Users -> "Add user"
--    Create the owner with a strong password and confirm the email.
-- 2. Copy the new user's UUID.
-- 3. Replace the two placeholders below and run this file.
--
-- Public signup must stay disabled:
--   Authentication -> Providers -> Email -> disable "Allow new users to sign up"
-- ============================================================================

insert into admin_profiles (user_id, email, display_name, role, is_active)
values (
  '00000000-0000-0000-0000-000000000000', -- replace with auth.users.id
  'owner@example.com',                     -- replace with the admin email
  'Owner',
  'owner',
  true
);
