-- ============================================================================
-- 0003_multi_opening.sql — Support multiple openings per source capture
-- Runs on Supabase PostgreSQL (free tier compatible).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Add opening_key and publication_number to opportunities
-- ----------------------------------------------------------------------------

alter table opportunities add column if not exists opening_key integer not null default 1;
alter table opportunities add column if not exists publication_number integer;

-- ----------------------------------------------------------------------------
-- Dedicated sequence for atomic publication numbering
-- ----------------------------------------------------------------------------
create sequence if not exists opportunity_publication_number_seq start with 1;

-- ----------------------------------------------------------------------------
-- Replace the single canonical_source_key unique index with a composite
-- (canonical_source_key, opening_key) index. This allows multiple openings
-- from the same source (different opening_key values) while still preventing
-- duplicate openings with the same key.
-- ----------------------------------------------------------------------------
drop index if exists opportunities_canonical_source_uidx;
create unique index if not exists opportunities_canonical_source_uidx
  on opportunities (canonical_source_key, opening_key)
  where canonical_source_key is not null and status not in ('rejected','archived');

-- ----------------------------------------------------------------------------
-- Add index on opening_key for efficient per-source queries.
-- ----------------------------------------------------------------------------
create index if not exists idx_opportunities_opening_key on opportunities (opening_key);

-- ----------------------------------------------------------------------------
-- Add index on publication_number for sequential numbering queries.
-- ----------------------------------------------------------------------------
create index if not exists idx_opportunities_publication_number on opportunities (publication_number);

-- ----------------------------------------------------------------------------
-- Add a check that opening_key is >= 1.
-- ----------------------------------------------------------------------------
do $$ begin
  alter table opportunities add constraint chk_opening_key_positive check (opening_key >= 1);
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- Add a trigger to set opening_key when a new opportunity is inserted.
-- ----------------------------------------------------------------------------
create or replace function set_opening_key()
returns trigger
language plpgsql
as $$
begin
  if new.canonical_source_key is not null and new.opening_key is null then
    select coalesce(
      (select max(opening_key) from opportunities o2
       where o2.canonical_source_key = new.canonical_source_key
         and o2.status not in ('rejected','archived')),
      0
    ) + 1
    into new.opening_key;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists opportunities_opening_key_trigger on opportunities;
create trigger opportunities_opening_key_trigger
  before insert on opportunities
  for each row execute function set_opening_key();

-- ----------------------------------------------------------------------------
-- Add a check that publication_number is positive when set.
-- ----------------------------------------------------------------------------
do $$ begin
  alter table opportunities add constraint chk_publication_number_positive
    check (publication_number is null or publication_number >= 1);
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- Atomically allocate sequential publication number on publish
-- ----------------------------------------------------------------------------
create or replace function set_publication_number_on_publish()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' and new.publication_number is null then
    new.publication_number := nextval('opportunity_publication_number_seq');
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists opportunities_publication_number_trigger on opportunities;
create trigger opportunities_publication_number_trigger
  before insert or update on opportunities
  for each row execute function set_publication_number_on_publish();

-- ----------------------------------------------------------------------------
-- Update the opportunities_updated_at trigger.
-- ----------------------------------------------------------------------------
drop trigger if exists opportunities_updated_at on opportunities;
create trigger opportunities_updated_at before update on opportunities
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- Grant permissions.
-- ----------------------------------------------------------------------------
grant execute on function set_opening_key() to authenticated, service_role;
grant execute on function set_publication_number_on_publish() to authenticated, service_role;
grant usage, select on sequence opportunity_publication_number_seq to authenticated, anon, service_role;

comment on column opportunities.opening_key is 'Sequential number of this opening within its source capture (1, 2, 3, ...). Used to distinguish multiple openings from the same source.';
comment on column opportunities.publication_number is 'Global sequential number allocated at publication time for the fixed LinkedIn comment template. Never reused; republish allocates no new number.';
