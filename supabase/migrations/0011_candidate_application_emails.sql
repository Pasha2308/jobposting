-- Store only consented applicant interest. Candidate emails are never available
-- to anon/authenticated roles and are removed 180 days after the last redirect.
create table if not exists public.candidate_applications (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254),
  email_normalized text not null check (char_length(email_normalized) between 3 and 254),
  consented_at timestamptz not null,
  consent_text_version text not null,
  created_at timestamptz not null default now(),
  last_redirected_at timestamptz not null default now(),
  constraint candidate_applications_opportunity_email_key unique (opportunity_id, email_normalized)
);

create index if not exists candidate_applications_created_idx
  on public.candidate_applications(created_at desc);
create index if not exists candidate_applications_opportunity_idx
  on public.candidate_applications(opportunity_id, last_redirected_at desc);

alter table public.candidate_applications enable row level security;
revoke all on table public.candidate_applications from public, anon, authenticated;
grant select, insert, update, delete on table public.candidate_applications to service_role;

create or replace function public.purge_stale_candidate_applications()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare deleted_count integer;
begin
  delete from public.candidate_applications
  where last_redirected_at < now() - interval '180 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_stale_candidate_applications() from public, anon, authenticated;
grant execute on function public.purge_stale_candidate_applications() to service_role;
