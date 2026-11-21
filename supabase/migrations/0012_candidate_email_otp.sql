-- Candidate addresses are kept in this short-lived table only while a code is pending.
-- Successful verification moves them to candidate_applications, which is service-role only.
alter table public.candidate_applications add column if not exists verified_at timestamptz;

create table if not exists public.candidate_email_otps (
  email_hash text primary key check (email_hash ~ '^[a-f0-9]{64}$'),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  consented_at timestamptz not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  updated_at timestamptz not null default now()
);
create table if not exists public.candidate_email_otp_events (
  id bigint generated always as identity primary key,
  email_hash text not null check (email_hash ~ '^[a-f0-9]{64}$'),
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists candidate_email_otp_events_email_idx on public.candidate_email_otp_events(email_hash, created_at desc);
create index if not exists candidate_email_otp_events_ip_idx on public.candidate_email_otp_events(ip_hash, created_at desc);
alter table public.candidate_email_otps enable row level security;
alter table public.candidate_email_otp_events enable row level security;
revoke all on public.candidate_email_otps, public.candidate_email_otp_events from public, anon, authenticated, service_role;

create or replace function public.request_candidate_email_otp(
  p_email_hash text, p_opportunity_id uuid, p_code_hash text, p_consented_at timestamptz,
  p_ip_hash text, p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare email_count integer; ip_count integer; daily_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_email_hash, 0));
  select count(*) into email_count from candidate_email_otp_events where email_hash = p_email_hash and created_at > p_now - interval '1 hour';
  select count(*) into ip_count from candidate_email_otp_events where ip_hash = p_ip_hash and created_at > p_now - interval '1 hour';
  select count(*) into daily_count from candidate_email_otp_events where created_at > p_now - interval '24 hours';
  if email_count >= 5 or ip_count >= 10 or daily_count >= 80 then return jsonb_build_object('allowed', false, 'reason', 'rate_limited'); end if;
  if not exists (select 1 from opportunities where id = p_opportunity_id and status = 'published' and published_at is not null and closed_at is null and (expires_at is null or expires_at >= current_date)) then
    return jsonb_build_object('allowed', false, 'reason', 'job_unavailable');
  end if;
  insert into candidate_email_otp_events(email_hash, ip_hash, created_at) values (p_email_hash, p_ip_hash, p_now);
  delete from candidate_email_otps where expires_at <= p_now;
  insert into candidate_email_otps(email_hash, opportunity_id, code_hash, consented_at, expires_at, attempts, updated_at)
    values (p_email_hash, p_opportunity_id, p_code_hash, p_consented_at, p_now + interval '10 minutes', 0, p_now)
    on conflict (email_hash) do update set opportunity_id = excluded.opportunity_id, code_hash = excluded.code_hash,
      consented_at = excluded.consented_at, expires_at = excluded.expires_at, attempts = 0, updated_at = p_now;
  delete from candidate_email_otp_events where created_at < p_now - interval '2 days';
  return jsonb_build_object('allowed', true);
end $$;

create or replace function public.verify_candidate_email_otp(
  p_email text, p_email_hash text, p_code_hash text, p_now timestamptz default now(), p_consent_text_version text default 'candidate-apply-2026-11-otp'
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare otp candidate_email_otps%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_email_hash, 0));
  select * into otp from candidate_email_otps where email_hash = p_email_hash for update;
  if not found then return jsonb_build_object('verified', false, 'reason', 'missing'); end if;
  if otp.expires_at <= p_now then delete from candidate_email_otps where email_hash = p_email_hash; return jsonb_build_object('verified', false, 'reason', 'expired'); end if;
  if otp.attempts >= 5 then delete from candidate_email_otps where email_hash = p_email_hash; return jsonb_build_object('verified', false, 'reason', 'attempts'); end if;
  if otp.code_hash <> p_code_hash then
    update candidate_email_otps set attempts = attempts + 1 where email_hash = p_email_hash;
    return jsonb_build_object('verified', false, 'reason', case when otp.attempts + 1 >= 5 then 'attempts' else 'invalid' end);
  end if;
  if not exists (select 1 from opportunities where id = otp.opportunity_id and status = 'published' and published_at is not null and closed_at is null and (expires_at is null or expires_at >= current_date)) then
    delete from candidate_email_otps where email_hash = p_email_hash;
    return jsonb_build_object('verified', false, 'reason', 'job_unavailable');
  end if;
  insert into candidate_applications(opportunity_id, email, email_normalized, consented_at, consent_text_version, verified_at, last_redirected_at)
    values (otp.opportunity_id, p_email, p_email, otp.consented_at, p_consent_text_version, p_now, p_now)
    on conflict (opportunity_id, email_normalized) do update set consented_at = excluded.consented_at,
      consent_text_version = excluded.consent_text_version, verified_at = excluded.verified_at, last_redirected_at = excluded.last_redirected_at;
  delete from candidate_email_otps where email_hash = p_email_hash;
  return jsonb_build_object('verified', true);
end $$;

-- The existing daily cleanup also expires OTP hashes and old anti-abuse hashes.
create or replace function public.purge_stale_candidate_applications()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare deleted_count integer;
begin
  delete from candidate_applications where last_redirected_at < now() - interval '180 days';
  get diagnostics deleted_count = row_count;
  delete from candidate_email_otps where expires_at <= now();
  delete from candidate_email_otp_events where created_at < now() - interval '2 days';
  return deleted_count;
end $$;
revoke all on function public.purge_stale_candidate_applications() from public, anon, authenticated;
grant execute on function public.purge_stale_candidate_applications() to service_role;

revoke all on function public.request_candidate_email_otp(text, uuid, text, timestamptz, text, timestamptz) from public, anon, authenticated;
revoke all on function public.verify_candidate_email_otp(text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.request_candidate_email_otp(text, uuid, text, timestamptz, text, timestamptz) to service_role;
grant execute on function public.verify_candidate_email_otp(text, text, text, timestamptz, text) to service_role;
