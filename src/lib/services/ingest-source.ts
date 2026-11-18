import type { AIProvider } from '../ai/provider';
import type { SourceCapture } from '../domain/types';
import { canonicalSourceKey, extractLinkedInPostId, isLinkedInPostUrl, normalizeSourceUrl } from '../domain/url';
import type { RetrievalFailure, RetrievalFn, RetrievalResult } from '../linkedin/types';
import type { Store } from '../store/types';
import { processCapture, type ProcessCaptureResult } from './capture';
import { ServiceError } from './errors';

/** Initial attempt plus three automated retries. Manual retries are exempt. */
export const RETRIEVAL_MAX_ATTEMPTS = 4;
const RETRIEVAL_CRON_UTC_HOUR = 3;
const CRON_START_GRACE_MS = 5 * 60_000;

export type IngestInput = {
  sourceUrl: string;
  submittedCompany?: string | null;
  actor: string;
  telegramUserId?: number | null;
  telegramChatId?: number | null;
  telegramMessageId?: number | null;
};

export type IngestResult =
  | { ok: true; capture: SourceCapture; result: ProcessCaptureResult }
  | {
      ok: false;
      capture: SourceCapture | null;
      errorCode: RetrievalFailure['errorCode'] | 'duplicate' | 'invalid_url';
      message: string;
      retryable: boolean;
      duplicate?: { captureId: string; opportunityId: string | null; status: string };
    };

/** vercel.json runs this recovery worker once daily at 03:00 UTC. Schedule
 * failures for the next run so the admin never sees a retry time the worker
 * cannot meet. The grace window avoids racing a cron run already starting. */
export function nextScheduledRetrievalRetry(now = new Date()): string {
  let next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RETRIEVAL_CRON_UTC_HOUR);
  if (next <= now.getTime() + CRON_START_GRACE_MS) next += 24 * 60 * 60_000;
  return new Date(next).toISOString();
}

export function retrievalMessage(code: RetrievalFailure['errorCode']): string {
  switch (code) {
    case 'retrieval_not_authorised':
      return 'Automatic LinkedIn retrieval is not authorised. The capture and original URL are saved; retry after an authorised retrieval method is configured.';
    case 'login_required':
      return 'LinkedIn requires sign-in for this post. No login bypass was attempted; the capture and original URL are saved.';
    case 'not_found':
      return 'LinkedIn reports that this post does not exist or was deleted. The capture and original URL are saved.';
    case 'no_content':
      return 'The page contained no extractable public post text (it may be image-only). The capture and original URL are saved.';
    case 'rate_limited':
      return 'LinkedIn rate-limited retrieval. The capture is saved and an automatic retry is scheduled.';
    case 'timeout':
      return 'LinkedIn did not respond before the retrieval deadline. The capture is saved and an automatic retry is scheduled.';
    case 'network_error':
      return 'LinkedIn could not be reached. The capture is saved and an automatic retry is scheduled.';
    case 'http_error':
      return 'LinkedIn returned a server error. The capture is saved and an automatic retry is scheduled.';
    case 'too_large':
      return 'The source page exceeded the safe retrieval size limit. The capture and original URL are saved.';
    case 'blocked_host':
      return 'Retrieval was redirected outside LinkedIn and was stopped for safety. The capture and original URL are saved.';
    case 'unsupported_url':
      return 'This URL did not resolve to a specific LinkedIn post. The capture and original URL are saved for review.';
    default:
      return 'The post could not be retrieved. The capture and original URL are saved for retry.';
  }
}

async function persistFailure(
  store: Store,
  capture: SourceCapture,
  failure: RetrievalFailure,
  attempts: number,
): Promise<SourceCapture> {
  const shouldRetry = failure.retryable && attempts < RETRIEVAL_MAX_ATTEMPTS;
  // "Not authorised" is a configuration state, not a transient failure: the
  // capture moves straight to manual-source mode while keeping the URL.
  const status = failure.errorCode === 'retrieval_not_authorised' ? 'awaiting_text' : 'retrieval_failed';
  return store.updateCapture(capture.id, {
    status,
    retrieval_status: failure.errorCode === 'retrieval_not_authorised' ? 'skipped' : 'failed',
    retrieval_method: failure.method,
    retrieval_http_status: failure.httpStatus,
    retrieval_error_code: failure.errorCode,
    retrieval_attempts: attempts,
    next_retry_at: shouldRetry ? nextScheduledRetrievalRetry() : null,
    error_message: failure.message,
    processing_started_at: null,
  });
}

async function persistSuccess(store: Store, capture: SourceCapture, result: Extract<RetrievalResult, { ok: true }>, attempts: number): Promise<SourceCapture> {
  return store.updateCapture(capture.id, {
    status: 'received',
    raw_text: result.post.text,
    retrieval_status: 'retrieved',
    retrieval_method: result.method,
    retrieval_http_status: result.httpStatus,
    retrieval_error_code: null,
    retrieval_attempts: attempts,
    retrieved_at: new Date().toISOString(),
    next_retry_at: null,
    source_author: result.post.author,
    source_posted_at: result.post.postedAt,
    source_metadata: { ...result.post.metadata, canonical_url: result.post.canonicalUrl },
    source_comments: result.post.comments,
    error_message: null,
    processing_started_at: null,
  });
}

/**
 * URL-first ingestion.
 *
 * The capture row is persisted before the network call. Any failure keeps the
 * URL, records the exact reason, and either schedules an automatic retry or
 * asks for copied text. Nothing is ever silently dropped.
 */
export async function ingestLinkedInUrl(
  store: Store,
  ai: AIProvider | null,
  input: IngestInput,
  retrieval: RetrievalFn,
  opts: { siteUrl: string },
): Promise<IngestResult> {
  const originalSourceUrl = input.sourceUrl.trim();
  const normalized = normalizeSourceUrl(originalSourceUrl);
  if (!normalized || !isLinkedInPostUrl(normalized)) {
    return {
      ok: false,
      capture: null,
      errorCode: 'invalid_url',
      message: 'Send a link to one specific LinkedIn post.',
      retryable: false,
    };
  }

  const postId = extractLinkedInPostId(normalized);
  const sourceKey = canonicalSourceKey(normalized, postId);
  if (!sourceKey) {
    return { ok: false, capture: null, errorCode: 'invalid_url', message: 'Send a valid LinkedIn post URL.', retryable: false };
  }

  const existing = await store.getCaptureBySourceKey(sourceKey);
  if (existing && !['rejected', 'extraction_failed', 'retrieval_failed'].includes(existing.status)) {
    return {
      ok: false,
      capture: existing,
      errorCode: 'duplicate',
      message: `This source has already been captured (${existing.status}).`,
      retryable: false,
      duplicate: {
        captureId: existing.id,
        opportunityId: existing.opportunity_id,
        status: existing.status,
      },
    };
  }

  // A previous attempt already has usable text (e.g. copied text arrived but
  // extraction failed). Re-run extraction without another retrieval.
  if (existing && existing.raw_text.trim().length >= 40) {
    const capture = await store.updateCapture(existing.id, {
      status: 'received',
      error_message: null,
      processing_started_at: null,
    });
    const result = await processCapture(store, ai, capture.id, {
      actor: input.actor,
      siteUrl: opts.siteUrl,
    });
    return { ok: true, capture: result.capture, result };
  }

  const capture = existing
    ? await store.updateCapture(existing.id, {
        status: 'retrieving',
        retrieval_status: 'pending',
        retrieval_error_code: null,
        next_retry_at: null,
        retrieval_attempts: 0,
        error_message: null,
        processing_started_at: new Date().toISOString(),
      })
    : await store.createCapture({
        source_url: originalSourceUrl,
        normalized_source_key: sourceKey,
        source_post_id: postId,
        source_type: 'linkedin_post',
        raw_text: '',
        status: 'retrieving',
        retrieval_status: 'pending',
        retrieval_attempts: 0,
        submitted_company: input.submittedCompany ?? null,
        created_by: input.actor,
        telegram_user_id: input.telegramUserId ?? null,
        telegram_chat_id: input.telegramChatId ?? null,
        telegram_message_id: input.telegramMessageId ?? null,
      });

  await store.logActivity({
    actor: input.actor,
    action: 'capture.retrieval_started',
    entity_type: 'source_capture',
    entity_id: capture.id,
    metadata: { source_url: normalized, activity_id: postId },
  });

  let outcome: RetrievalResult;
  try {
    outcome = await retrieval(normalized);
  } catch (error) {
    outcome = {
      ok: false,
      method: null,
      errorCode: 'network_error',
      httpStatus: null,
      message: error instanceof Error ? error.message : 'Retrieval failed unexpectedly.',
      retryable: true,
    };
  }

  const attempts = capture.retrieval_attempts + 1;

  if (!outcome.ok) {
    const failed = await persistFailure(store, capture, outcome, attempts);
    await store
      .logActivity({
        actor: input.actor,
        action: 'capture.retrieval_failed',
        entity_type: 'source_capture',
        entity_id: capture.id,
        metadata: { error_code: outcome.errorCode, http_status: outcome.httpStatus },
      })
      .catch(() => undefined);
    return {
      ok: false,
      capture: failed,
      errorCode: outcome.errorCode,
      message: outcome.message,
      retryable: outcome.retryable,
    };
  }

  const retrieved = await persistSuccess(store, capture, outcome, attempts);
  await store.logActivity({
    actor: input.actor,
    action: 'capture.retrieved',
    entity_type: 'source_capture',
    entity_id: capture.id,
    metadata: {
      method: outcome.method,
      http_status: outcome.httpStatus,
      chars: outcome.post.text.length,
      comments: outcome.post.comments.length,
    },
  });

  const result = await processCapture(store, ai, retrieved.id, {
    actor: input.actor,
    siteUrl: opts.siteUrl,
  });
  return { ok: true, capture: result.capture, result };
}

/**
 * Re-runs retrieval for a preserved capture (admin retry or cron).
 * Manual retries are explicit, so the attempt limit does not block them.
 */
export async function retryRetrieval(
  store: Store,
  ai: AIProvider | null,
  captureId: string,
  retrieval: RetrievalFn,
  opts: { actor: string; siteUrl: string; claimed?: boolean },
): Promise<IngestResult> {
  const capture = await store.getCapture(captureId);
  if (!capture) throw new ServiceError('not_found', 'Capture not found.', 404);
  if (!capture.source_url) {
    throw new ServiceError('no_source_url', 'This capture has no source URL to retrieve.', 409);
  }
  if (!['retrieval_failed', 'awaiting_text', 'retrieving'].includes(capture.status)) {
    throw new ServiceError(
      'not_retryable',
      `A capture in "${capture.status}" cannot be re-retrieved.`,
      409,
    );
  }

  if (!opts.claimed) {
    await store.updateCapture(captureId, {
      status: 'retrieving',
      processing_started_at: new Date().toISOString(),
      next_retry_at: null,
      error_message: null,
    });
  }

  const attempts = capture.retrieval_attempts + (opts.claimed ? 0 : 1);
  let outcome: RetrievalResult;
  try {
    outcome = await retrieval(normalizeSourceUrl(capture.source_url) ?? capture.source_url);
  } catch (error) {
    outcome = {
      ok: false,
      method: null,
      errorCode: 'network_error',
      httpStatus: null,
      message: error instanceof Error ? error.message : 'Retrieval failed unexpectedly.',
      retryable: true,
    };
  }

  if (!outcome.ok) {
    const failed = await persistFailure(store, capture, outcome, attempts);
    return {
      ok: false,
      capture: failed,
      errorCode: outcome.errorCode,
      message: outcome.message,
      retryable: outcome.retryable,
    };
  }

  const retrieved = await persistSuccess(store, capture, outcome, attempts);
  const result = await processCapture(store, ai, retrieved.id, {
    actor: opts.actor,
    siteUrl: opts.siteUrl,
  });
  return { ok: true, capture: result.capture, result };
}
