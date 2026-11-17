-- ============================================================================
-- 0004_capture_retrieval_enum.sql — Retrieval lifecycle statuses
--
-- Must be its own migration: PostgreSQL cannot use a newly added enum value in
-- the same transaction that adds it, so columns/indexes using these values
-- live in 0005/0006.
-- ============================================================================

alter type capture_status add value if not exists 'retrieving';
alter type capture_status add value if not exists 'retrieval_failed';
