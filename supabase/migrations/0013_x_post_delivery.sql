-- Separate X draft queue. Every third publication is eligible, giving a 3:1
-- LinkedIn-to-X ratio without spending AI quota.
create table if not exists x_post_delivery_queue (
  opportunity_id uuid primary key references opportunities(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','sending','sent','acknowledged','failed')),
  batch_number bigint, telegram_message_id bigint, attempts integer not null default 0,
  last_error text, retryable boolean not null default true, sending_started_at timestamptz,
  created_at timestamptz not null default now(), sent_at timestamptz, acknowledged_at timestamptz
);
create index if not exists x_delivery_queue_status_idx on x_post_delivery_queue(status, created_at);
alter table x_post_delivery_queue enable row level security;
revoke all on x_post_delivery_queue from public, anon, authenticated;
grant select, insert, update, delete on x_post_delivery_queue to service_role;
create sequence if not exists x_delivery_batch_seq;

create or replace function enqueue_x_post(p_opportunity_id uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare inserted integer;
begin
  insert into x_post_delivery_queue(opportunity_id)
  select id from opportunities where id=p_opportunity_id and status='published' and publication_number % 3 = 0
  on conflict do nothing;
  get diagnostics inserted=row_count; return inserted=1;
end; $$;
revoke all on function enqueue_x_post(uuid) from public,anon,authenticated;
grant execute on function enqueue_x_post(uuid) to service_role;

create or replace function queue_x_post_after_publish() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='published' and new.published_at is not null and new.publication_number is not null and new.publication_number % 3 = 0 then
    insert into x_post_delivery_queue(opportunity_id) values(new.id) on conflict do nothing;
  end if;
  return new;
end; $$;
revoke all on function queue_x_post_after_publish() from public,anon,authenticated;
drop trigger if exists opportunities_queue_x_post on opportunities;
create trigger opportunities_queue_x_post after insert or update of status on opportunities for each row execute function queue_x_post_after_publish();

insert into x_post_delivery_queue(opportunity_id)
select id from opportunities where status='published' and published_at is not null and publication_number % 3 = 0
on conflict do nothing;

create or replace function claim_next_x_delivery_batch(p_limit integer default 10)
returns table(opportunity_id uuid,batch_number bigint) language plpgsql security definer set search_path=public,pg_temp as $$
declare active_batch bigint; chosen_batch bigint;
begin
  perform pg_advisory_xact_lock(hashtext('hustler-community-x-delivery'));
  update x_post_delivery_queue set status='failed',last_error=coalesce(last_error,'Delivery worker lease expired.') where status='sending' and coalesce(sending_started_at,created_at)<now()-interval '10 minutes';
  select q.batch_number into active_batch from x_post_delivery_queue q where q.batch_number is not null and q.status in ('sent','failed','sending') order by q.batch_number limit 1;
  if active_batch is not null then
    if exists(select 1 from x_post_delivery_queue where batch_number=active_batch and status='sending') then return; end if;
    chosen_batch:=active_batch;
    update x_post_delivery_queue q set status='sending',attempts=attempts+1,sending_started_at=now() where q.opportunity_id in
      (select q2.opportunity_id from x_post_delivery_queue q2 where q2.batch_number=chosen_batch and q2.status='failed' and q2.retryable order by q2.created_at limit greatest(1,least(p_limit,10)) for update skip locked);
  else
    chosen_batch:=nextval('x_delivery_batch_seq');
    update x_post_delivery_queue q set status='sending',batch_number=chosen_batch,attempts=attempts+1,sending_started_at=now() where q.opportunity_id in
      (select q2.opportunity_id from x_post_delivery_queue q2 where q2.status='queued' order by q2.created_at limit greatest(1,least(p_limit,10)) for update skip locked);
  end if;
  return query select q.opportunity_id,q.batch_number from x_post_delivery_queue q where q.batch_number=chosen_batch and q.status='sending' and q.sending_started_at>=now()-interval '1 second' order by q.created_at;
end; $$;
revoke all on function claim_next_x_delivery_batch(integer) from public,anon,authenticated;
grant execute on function claim_next_x_delivery_batch(integer) to service_role;

create or replace function acknowledge_x_delivery_batch(p_batch_number bigint) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare affected integer;
begin
  if exists(select 1 from x_post_delivery_queue where batch_number=p_batch_number and status in ('failed','sending')) then return false; end if;
  update x_post_delivery_queue set status='acknowledged',acknowledged_at=now() where batch_number=p_batch_number and status='sent';
  get diagnostics affected=row_count; return affected>0;
end; $$;
revoke all on function acknowledge_x_delivery_batch(bigint) from public,anon,authenticated;
grant execute on function acknowledge_x_delivery_batch(bigint) to service_role;
