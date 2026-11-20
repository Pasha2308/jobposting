-- Separate control bot state; the LinkedIn intake bot has a separate update namespace.
alter table telegram_updates add column if not exists bot_key text not null default 'capture';
alter table telegram_updates drop constraint if exists telegram_updates_pkey;
alter table telegram_updates add constraint telegram_updates_pkey primary key (bot_key, update_id);

create table if not exists portfolio_bot_admin_chats (
  telegram_user_id bigint primary key,
  chat_id bigint not null,
  verified_at timestamptz not null default now()
);
alter table portfolio_bot_admin_chats enable row level security;
revoke all on table portfolio_bot_admin_chats from public, anon, authenticated;
grant select, insert, update, delete on table portfolio_bot_admin_chats to service_role;

create table if not exists portfolio_search_runs (
  id uuid primary key default gen_random_uuid(),
  requested_by bigint not null,
  status text not null check (status in ('running','completed','partial','failed')),
  full_backfill boolean not null default false,
  started_at timestamptz not null default now(),
  progress_at timestamptz not null default now(),
  finished_at timestamptz,
  report jsonb not null default '{}'::jsonb
);
create index if not exists portfolio_search_runs_started_idx on portfolio_search_runs(started_at desc);
alter table portfolio_search_runs enable row level security;
revoke all on table portfolio_search_runs from public, anon, authenticated;
grant select, insert, update on table portfolio_search_runs to service_role;

create or replace function claim_portfolio_search(p_requested_by bigint, p_full_backfill boolean)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('hustler-community-portfolio-search'));
  update portfolio_search_runs set status = 'failed', finished_at = now(),
    report = jsonb_build_object('error', 'Previous run lease expired; source checkpoints remain available for retry.')
  where status = 'running' and progress_at < now() - interval '30 minutes';
  if exists (select 1 from portfolio_search_runs where status = 'running') then return null; end if;
  insert into portfolio_search_runs(requested_by, status, full_backfill)
  values (p_requested_by, 'running', p_full_backfill) returning id into new_id;
  return new_id;
end;
$$;
revoke all on function claim_portfolio_search(bigint, boolean) from public, anon, authenticated;
grant execute on function claim_portfolio_search(bigint, boolean) to service_role;

create table if not exists linkedin_post_delivery_queue (
  opportunity_id uuid primary key references opportunities(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','sending','sent','acknowledged','failed')),
  batch_number bigint,
  telegram_message_id bigint,
  attempts integer not null default 0,
  last_error text,
  retryable boolean not null default true,
  sending_started_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  acknowledged_at timestamptz
);
create index if not exists linkedin_delivery_queue_status_idx on linkedin_post_delivery_queue(status, created_at);
create index if not exists linkedin_delivery_queue_batch_idx on linkedin_post_delivery_queue(batch_number, status);
alter table linkedin_post_delivery_queue enable row level security;
revoke all on table linkedin_post_delivery_queue from public, anon, authenticated;
grant select, insert, update, delete on table linkedin_post_delivery_queue to service_role;
create sequence if not exists linkedin_delivery_batch_seq;

create or replace function queue_linkedin_post_after_publish()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published')
    and new.published_at is not null and new.linkedin_post_draft is not null and btrim(new.linkedin_post_draft) <> '' then
    insert into linkedin_post_delivery_queue(opportunity_id) values (new.id) on conflict (opportunity_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function queue_linkedin_post_after_publish() from public, anon, authenticated;
drop trigger if exists opportunities_queue_linkedin_post on opportunities;
create trigger opportunities_queue_linkedin_post after insert or update of status on opportunities
for each row execute function queue_linkedin_post_after_publish();

create or replace function enqueue_linkedin_post(p_opportunity_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare inserted integer;
begin
  insert into linkedin_post_delivery_queue(opportunity_id)
  select id from opportunities where id = p_opportunity_id and status = 'published'
    and published_at is not null and linkedin_post_draft is not null and btrim(linkedin_post_draft) <> ''
  on conflict (opportunity_id) do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end;
$$;
revoke all on function enqueue_linkedin_post(uuid) from public, anon, authenticated;
grant execute on function enqueue_linkedin_post(uuid) to service_role;

create or replace function claim_next_linkedin_delivery_batch(p_limit integer default 30)
returns table(opportunity_id uuid, batch_number bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare active_batch bigint;
        chosen_batch bigint;
begin
  perform pg_advisory_xact_lock(hashtext('hustler-community-linkedin-delivery'));
  update linkedin_post_delivery_queue set status = 'failed', last_error = coalesce(last_error, 'Delivery worker lease expired.')
    where status = 'sending' and coalesce(sending_started_at, created_at) < now() - interval '10 minutes';
  select q.batch_number into active_batch from linkedin_post_delivery_queue q
    where q.batch_number is not null and q.status in ('sent','failed','sending') order by q.batch_number limit 1;
  if active_batch is not null then
    -- A second worker must never receive rows another invocation is already
    -- sending. Only claim failed rows after the current attempt has finished.
    if exists (select 1 from linkedin_post_delivery_queue where batch_number = active_batch and status = 'sending') then
      return;
    end if;
    chosen_batch := active_batch;
    update linkedin_post_delivery_queue q set status = 'sending', attempts = attempts + 1, sending_started_at = now()
    where q.opportunity_id in (
      select q2.opportunity_id from linkedin_post_delivery_queue q2
        where q2.batch_number = chosen_batch and q2.status = 'failed' and q2.retryable = true
      order by q2.created_at limit greatest(1, least(p_limit, 30)) for update skip locked
    );
  else
    chosen_batch := nextval('linkedin_delivery_batch_seq');
    update linkedin_post_delivery_queue q set status = 'sending', batch_number = chosen_batch, attempts = attempts + 1, sending_started_at = now()
    where q.opportunity_id in (
      select q2.opportunity_id from linkedin_post_delivery_queue q2
      where q2.status = 'queued' order by q2.created_at
      limit greatest(1, least(p_limit, 30)) for update skip locked
    );
  end if;
  return query select q.opportunity_id, q.batch_number from linkedin_post_delivery_queue q
    where q.batch_number = chosen_batch and q.status = 'sending'
      and q.sending_started_at >= now() - interval '1 second'
    order by q.created_at;
end;
$$;
revoke all on function claim_next_linkedin_delivery_batch(integer) from public, anon, authenticated;
grant execute on function claim_next_linkedin_delivery_batch(integer) to service_role;

create or replace function acknowledge_linkedin_delivery_batch(p_batch_number bigint)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare affected integer;
begin
  if exists (select 1 from linkedin_post_delivery_queue where batch_number = p_batch_number and status in ('failed','sending')) then return false; end if;
  update linkedin_post_delivery_queue set status = 'acknowledged', acknowledged_at = now()
    where batch_number = p_batch_number and status = 'sent';
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;
revoke all on function acknowledge_linkedin_delivery_batch(bigint) from public, anon, authenticated;
grant execute on function acknowledge_linkedin_delivery_batch(bigint) to service_role;
