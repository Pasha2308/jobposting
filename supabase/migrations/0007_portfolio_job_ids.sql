-- Stable, short public identifiers for every opportunity. Existing rows receive
-- IDs in creation order; the sequence continues after the backfill.
create sequence if not exists opportunity_job_code_seq;

alter table opportunities add column if not exists job_code text;
alter table opportunities add column if not exists linkedin_post_draft text;
alter table opportunities add column if not exists is_portfolio_discovered boolean not null default false;
alter table opportunities add column if not exists portfolio_notified_at timestamptz;
alter table opportunities add column if not exists portfolio_notification_error text;
alter table opportunities add column if not exists portfolio_notification_claimed_at timestamptz;

with numbered as (
  select id, row_number() over (order by created_at, id) as n
  from opportunities
  where job_code is null
)
update opportunities o
set job_code = 'HC-' || lpad(numbered.n::text, 6, '0')
from numbered
where o.id = numbered.id;

select setval(
  'opportunity_job_code_seq',
  greatest(coalesce((select max(substring(job_code from 4)::bigint) from opportunities), 0), 1),
  coalesce((select max(substring(job_code from 4)::bigint) from opportunities), 0) > 0
);

alter table opportunities alter column job_code set not null;
alter table opportunities add constraint opportunities_job_code_format
  check (job_code ~ '^HC-[0-9]{6,}$');
create unique index if not exists opportunities_job_code_uidx on opportunities(job_code);

create or replace function assign_opportunity_job_code()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.job_code is null or new.job_code = '' then
    new.job_code := 'HC-' || lpad(nextval('opportunity_job_code_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists opportunities_assign_job_code on opportunities;
create trigger opportunities_assign_job_code
before insert on opportunities
for each row execute function assign_opportunity_job_code();

revoke all on function assign_opportunity_job_code() from public, anon, authenticated;
grant execute on function assign_opportunity_job_code() to service_role;
grant usage, select on sequence opportunity_job_code_seq to service_role;

-- Persistent 48-hour scheduler state; a failed source remains due for retry.
create table if not exists portfolio_discovery_state (
  source_id text primary key,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table portfolio_discovery_state enable row level security;
revoke all on table portfolio_discovery_state from public, anon, authenticated;
grant select, insert, update on table portfolio_discovery_state to service_role;

-- Atomic notification claim prevents the post-publish request and daily retry
-- worker from sending the same job concurrently. Stale claims recover after 5m.
create or replace function claim_portfolio_job_notification(p_opportunity_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare affected integer;
begin
  update opportunities
  set portfolio_notification_claimed_at = now()
  where id = p_opportunity_id
    and is_portfolio_discovered = true
    and status = 'published'
    and published_at is not null
    and portfolio_notified_at is null
    and (portfolio_notification_claimed_at is null or portfolio_notification_claimed_at < now() - interval '5 minutes');
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
revoke all on function claim_portfolio_job_notification(uuid) from public, anon, authenticated;
grant execute on function claim_portfolio_job_notification(uuid) to service_role;
