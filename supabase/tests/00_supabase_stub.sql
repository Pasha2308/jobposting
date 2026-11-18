-- ============================================================================
-- Minimal Supabase-compatible prelude for migration tests on a plain
-- PostgreSQL instance (local or CI). It recreates only the objects that the
-- migrations in this repository reference: the `auth` schema, `auth.users`,
-- and the three API roles with their default privileges.
--
-- This file is NOT applied to the real Supabase project. Supabase already
-- provides all of it.
-- ============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
