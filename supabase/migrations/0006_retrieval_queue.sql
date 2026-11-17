-- ============================================================================
-- 0006_retrieval_queue.sql — Atomic retry queue for failed retrievals.
-- ============================================================================

create index if not exists source_captures_retrieval_queue_idx
  on source_captures (next_retry_at)
  where status = 'retrieval_failed';

create index if not exists source_captures_retrieving_stale_idx
  on source_captures (processing_started_at)
  where status = 'retrieving';

-- Atomically claim due retries. The cron endpoint and a manual admin retry can
-- never process the same capture twice: FOR UPDATE SKIP LOCKED only hands a
-- row to one caller.
create or replace function claim_retrieval_retries(p_limit integer default 5)
returns setof source_captures
language sql
security definer
set search_path = public
as $$
  with due as (
    select id
    from source_captures
    where status = 'retrieval_failed'
      and next_retry_at is not null
      and next_retry_at <= now()
      and retrieval_attempts < 4
    order by next_retry_at
    limit greatest(1, least(p_limit, 25))
    for update skip locked
  )
  update source_captures c
     set status = 'retrieving',
         processing_started_at = now(),
         retrieval_attempts = c.retrieval_attempts + 1
    from due
   where c.id = due.id
  returning c.*;
$$;

revoke all on function claim_retrieval_retries(integer) from public, anon, authenticated;
grant execute on function claim_retrieval_retries(integer) to service_role;

comment on function claim_retrieval_retries(integer) is
  'Claims up to p_limit due retrieval_failed captures for a single worker. service_role only.';
