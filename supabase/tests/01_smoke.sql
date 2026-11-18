-- ============================================================================
-- Migration smoke tests
--
-- Runs after 0001–0006 against a throwaway PostgreSQL database. It proves the
-- behaviours that the application relies on and that unit tests (which use the
-- in-memory store) cannot prove:
--
--   1. multiple openings from one source persist as separate rows
--   2. the composite (canonical_source_key, opening_key) index blocks duplicates
--   3. rejected rows do not block re-adding the same opening key
--   4. opening_key is assigned automatically when SQL omits it
--   5. publication numbers are sequential and never reused on republish
--   6. invalid lifecycle transitions are rejected
--   7. the public search RPC only returns live, published rows
--   8. RLS hides drafts and blocks anonymous writes
--   9. claim_retrieval_retries() never hands the same row to two callers
--  10. hc_array_to_text() is genuinely IMMUTABLE (the 42P17 fix)
--
-- Every assertion raises an exception on failure, so `psql -v ON_ERROR_STOP=1`
-- fails the job. Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/01_smoke.sql
-- ============================================================================

\set ON_ERROR_STOP on

-- Deterministic ids so the assertions are readable.
insert into companies (id, name, slug, verified)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Acme Labs', 'acme-labs', true);

insert into source_captures (id, source_url, normalized_source_key, source_post_id, source_type, raw_text, created_by)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'https://www.linkedin.com/feed/update/urn:li:activity:1111111111111111111',
  'urn:li:activity:1111111111111111111',
  '1111111111111111111',
  'linkedin_post',
  repeat('source text for five openings ', 20),
  'test'
);

-- 1. Five openings from one source -----------------------------------------
insert into opportunities (slug, title, company_id, category_id, status, canonical_source_key, opening_key,
  source_capture_id, source_url, summary, country, city, work_mode, employment_type,
  salary_min, salary_max, currency, application_method, application_url, completeness_score)
select
  'role-' || n,
  'Role ' || n,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  (select id from categories order by sort_order limit 1),
  'pending_review',
  'urn:li:activity:1111111111111111111',
  n,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'https://www.linkedin.com/feed/update/urn:li:activity:1111111111111111111',
  'Acme Labs is hiring for role ' || n || ' to join the Bengaluru team.',
  'India', 'Bengaluru', 'hybrid', 'full_time',
  1200000 + n, 1500000 + n, 'INR', 'external_url', 'https://acme.test/apply/' || n, 0.750
from generate_series(1, 5) n;

do $$
declare n integer;
begin
  select count(*) into n from opportunities where canonical_source_key = 'urn:li:activity:1111111111111111111';
  if n <> 5 then raise exception 'expected 5 openings, got %', n; end if;
  if (select count(distinct opening_key) from opportunities
      where canonical_source_key = 'urn:li:activity:1111111111111111111') <> 5 then
    raise exception 'opening_key values are not distinct';
  end if;
end $$;

-- 2. Duplicate opening is rejected by the composite unique index ------------
do $$
begin
  insert into opportunities (slug, title, status, canonical_source_key, opening_key, source_url)
  values ('role-duplicate', 'Role duplicate', 'pending_review',
          'urn:li:activity:1111111111111111111', 3,
          'https://www.linkedin.com/feed/update/urn:li:activity:1111111111111111111');
  raise exception 'duplicate opening_key was accepted';
exception
  when unique_violation then
    raise notice 'PASS duplicate opening blocked by unique index';
end $$;

-- 3. A rejected row does not block re-adding the same opening key -----------
insert into opportunities (slug, title, status, canonical_source_key, opening_key, source_url)
values ('role-3-old', 'Role 3 old', 'rejected',
        'urn:li:activity:1111111111111111111', 3,
        'https://www.linkedin.com/feed/update/urn:li:activity:1111111111111111111');

-- 4. opening_key is assigned when SQL omits it ------------------------------
insert into opportunities (slug, title, status, canonical_source_key, source_url)
values ('auto-1', 'Auto 1', 'pending_review', 'urn:li:activity:3333333333333333333',
        'https://www.linkedin.com/feed/update/urn:li:activity:3333333333333333333');
insert into opportunities (slug, title, status, canonical_source_key, source_url)
values ('auto-2', 'Auto 2', 'pending_review', 'urn:li:activity:3333333333333333333',
        'https://www.linkedin.com/feed/update/urn:li:activity:3333333333333333333');

do $$
begin
  if (select opening_key from opportunities where slug = 'auto-1') <> 1 then
    raise exception 'first auto opening_key should be 1';
  end if;
  if (select opening_key from opportunities where slug = 'auto-2') <> 2 then
    raise exception 'second auto opening_key should be 2';
  end if;
end $$;

-- 5. Publication numbering is atomic and never reused ----------------------
update opportunities set status = 'published', published_at = now(), last_verified_at = now()
where slug = 'role-1';
update opportunities set status = 'published', published_at = now(), last_verified_at = now()
where slug = 'role-2';

do $$
begin
  if (select publication_number from opportunities where slug = 'role-1') <> 1 then
    raise exception 'first publication_number should be 1';
  end if;
  if (select publication_number from opportunities where slug = 'role-2') <> 2 then
    raise exception 'second publication_number should be 2';
  end if;
end $$;

-- Republishing must keep the original number.
update opportunities set status = 'closed', closed_at = now() where slug = 'role-1';
update opportunities set status = 'published', published_at = now() where slug = 'role-1';
do $$
begin
  if (select publication_number from opportunities where slug = 'role-1') <> 1 then
    raise exception 'publication_number changed on republish';
  end if;
end $$;

-- 6. Invalid lifecycle transitions are rejected -----------------------------
do $$
begin
  update opportunities set status = 'draft' where slug = 'role-2';
  raise exception 'published -> draft was accepted';
exception
  when check_violation then
    raise notice 'PASS invalid lifecycle transition blocked';
end $$;

-- 7. Public search RPC works and hides non-published rows -------------------
do $$
declare result jsonb;
begin
  result := search_public_opportunities(p_q => 'Role 1');
  if (result->>'total')::int < 1 then
    raise exception 'search found nothing for a published role';
  end if;
  if exists (
    select 1 from jsonb_array_elements(result->'items') item
    where item->>'status' <> 'published'
  ) then
    raise exception 'search returned a non-published opportunity';
  end if;
  if (select count(*) from jsonb_array_elements(result->'items')) > 2 then
    raise exception 'search returned too many rows for "Role 1"';
  end if;
end $$;

-- 8. RLS hides drafts from anon, shows published rows -----------------------
set role anon;
do $$
declare n integer; p integer;
begin
  select count(*) into n from opportunities;
  if n <> 2 then raise exception 'anon should see exactly the 2 published rows, saw %', n; end if;
  select count(*) into p from opportunities where status = 'pending_review';
  if p <> 0 then raise exception 'anon can see pending_review rows'; end if;
end $$;
reset role;

-- Anon cannot write even with table grants.
set role anon;
do $$
begin
  insert into opportunities (slug, title) values ('anon-insert', 'Anon insert');
  raise exception 'anon insert was accepted';
exception
  when insufficient_privilege then
    raise notice 'PASS anon insert blocked';
end $$;
reset role;

-- 9. Atomic retry claim hands each row to one caller only ------------------
insert into source_captures (source_url, normalized_source_key, source_type, raw_text, created_by,
  status, retrieval_status, retrieval_attempts, next_retry_at, retrieval_error_code)
select
  'https://www.linkedin.com/feed/update/urn:li:activity:222222222222222222' || g,
  'urn:li:activity:222222222222222222' || g,
  'linkedin_post', repeat('queued source ', 10), 'test',
  'retrieval_failed', 'failed', 1, now() - interval '1 minute', 'timeout'
from generate_series(1, 6) g;

do $$
declare first_batch integer; second_batch integer;
begin
  select count(*) into first_batch from claim_retrieval_retries(5);
  select count(*) into second_batch from claim_retrieval_retries(5);
  if first_batch <> 5 then raise exception 'first claim returned % rows, expected 5', first_batch; end if;
  if second_batch <> 1 then raise exception 'second claim returned % rows, expected 1', second_batch; end if;
  if (select count(*) from source_captures where status = 'retrieving') <> 6 then
    raise exception 'not every claimed row moved to retrieving';
  end if;
end $$;

-- 10. hc_array_to_text is IMMUTABLE and searchable --------------------------
do $$
begin
  if (select provolatile from pg_proc where proname = 'hc_array_to_text') <> 'i' then
    raise exception 'hc_array_to_text is not immutable';
  end if;
end $$;

select 'ALL DATABASE SMOKE TESTS PASSED' as result;
