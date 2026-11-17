-- ============================================================================
-- 0005_capture_retrieval_columns.sql — Retrieval metadata and extraction
-- quality fields. Additive only; existing rows keep working with defaults.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- source_captures: how the source was retrieved, and what failed if it was not
-- ----------------------------------------------------------------------------
alter table source_captures
  add column if not exists retrieval_status text not null default 'pending'
    check (retrieval_status in ('pending', 'retrieved', 'failed', 'skipped')),
  add column if not exists retrieval_method text
    check (retrieval_method is null or retrieval_method in ('jsonld', 'manual_text', 'provider')),
  add column if not exists retrieval_http_status integer,
  add column if not exists retrieval_error_code text,
  add column if not exists retrieval_attempts integer not null default 0
    check (retrieval_attempts >= 0),
  add column if not exists retrieved_at timestamptz,
  add column if not exists next_retry_at timestamptz,
  add column if not exists source_author text,
  add column if not exists source_posted_at timestamptz,
  add column if not exists source_metadata jsonb,
  add column if not exists source_comments jsonb;

-- ----------------------------------------------------------------------------
-- opportunities: fields required by the operations brief that did not exist
-- ----------------------------------------------------------------------------
alter table opportunities
  add column if not exists education_requirements text[] not null default '{}',
  add column if not exists benefits text[] not null default '{}',
  add column if not exists languages text[] not null default '{}',
  add column if not exists recruiter_name text,
  add column if not exists quality_flags jsonb not null default '[]'::jsonb,
  add column if not exists completeness_score numeric(4,3)
    check (completeness_score is null or (completeness_score >= 0 and completeness_score <= 1));

comment on column source_captures.retrieval_status is
  'pending = URL saved but not attempted; retrieved = source content obtained; failed = retrieval failed and is queued for retry or manual text; skipped = retrieval not authorised, URL kept for manual text.';
comment on column source_captures.source_comments is
  'JSON array of {author, text, links[], is_author}. Per-role application links often appear only in the author comment.';
comment on column source_captures.source_metadata is
  'JSON object with post headline, repost/shared content, canonical activity urn, content hash and parser version.';
comment on column opportunities.quality_flags is
  'Deterministic flags from completeness scoring (missing_salary, missing_application_route, ...). Not authored by the AI.';
comment on column opportunities.completeness_score is
  'Deterministic 0..1 completeness score computed from field presence. Advisory only; it does not bypass publication rules.';
