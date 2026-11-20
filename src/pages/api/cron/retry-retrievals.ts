import type { APIRoute } from 'astro';
import type { AppEnv } from '../../../lib/env';
import { createAIProvider } from '../../../lib/ai';
import { createRetrievalService } from '../../../lib/linkedin/jsonld';
import { requireStore } from '../../../lib/services/context';
import { nextScheduledRetrievalRetry, retryRetrieval, RETRIEVAL_MAX_ATTEMPTS } from '../../../lib/services/ingest-source';
import { jsonResponse } from '../../../lib/http';
import { dispatchPortfolioDelivery } from '../../../lib/portfolio/linkedin-delivery';

/**
 * Recovery worker. Runs on the hosting plan's supported schedule (Vercel Hobby
 * allows one run per day; Pro can run every few minutes).
 *
 * Authentication: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when
 * CRON_SECRET is configured on the project. No secret means the endpoint is
 * unavailable rather than open.
 */
function authorised(request: Request, secret: string | null): boolean {
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${secret}`;
}

async function run(request: Request, env: AppEnv) {
  if (!authorised(request, env.cronSecret)) {
    return jsonResponse({ error: 'Unauthorised.' }, 401);
  }

  const store = requireStore(env);
  const ai = createAIProvider(env);
  const retrieval = createRetrievalService(env);

  // Queue errors must fail this invocation; pretending an empty queue could
  // silently strand submitted captures until somebody inspects the database.
  const recovered = await store.recoverStaleRetrieving(120);
  const recoveredExtractions = await store.recoverStaleExtracting(30 * 60);
  const claimed = await store.claimDueRetrievals(5);
  const settings = await store.getSettings().catch(() => null);
  const retentionDays = settings?.source_retention_days ?? 90;
  const purged = await store.purgeExpiredSourceText(retentionDays).catch(() => 0);
  if (recovered || recoveredExtractions || claimed.length) {
    console.info('[cron/retry-retrievals] queue run', {
      recovered,
      recoveredExtractions,
      claimed: claimed.length,
    });
  }

  const results: Array<{ captureId: string; ok: boolean; errorCode?: string }> = [];
  for (const capture of claimed) {
    try {
      const outcome = await retryRetrieval(store, ai, capture.id, retrieval, {
        actor: 'cron:retry-retrievals',
        siteUrl: env.siteUrl,
        claimed: true,
      });
      results.push({
        captureId: capture.id,
        ok: outcome.ok,
        ...(outcome.ok ? {} : { errorCode: outcome.errorCode }),
      });
      if (!outcome.ok) {
        console.warn('[cron/retry-retrievals] retrieval failed', {
          captureId: capture.id,
          errorCode: outcome.errorCode,
          attempts: outcome.capture?.retrieval_attempts ?? capture.retrieval_attempts,
          nextRetryAt: outcome.capture?.next_retry_at ?? null,
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 300) : 'Retry worker failed unexpectedly.';
      const current = await store.getCapture(capture.id);
      if (current?.status === 'retrieving') {
        const canRetry = current.retrieval_attempts < RETRIEVAL_MAX_ATTEMPTS;
        await store.updateCapture(capture.id, {
          status: 'retrieval_failed',
          retrieval_status: 'failed',
          retrieval_error_code: 'network_error',
          error_message: `Retry worker failed: ${reason}`,
          next_retry_at: canRetry ? nextScheduledRetrievalRetry() : null,
          processing_started_at: null,
        });
      }
      console.error('[cron/retry-retrievals] worker error', { captureId: capture.id, reason });
      results.push({
        captureId: capture.id,
        ok: false,
        errorCode: 'worker_error',
      });
    }
  }

  // Discovery is manually triggered from the portfolio control bot. This
  // existing daily worker remains responsible for queued Telegram retries.
  let linkedinDelivery = { sent: 0, failed: 0, batchNumber: null as number | null };
  try {
    linkedinDelivery = await dispatchPortfolioDelivery(env, store);
    if (linkedinDelivery.sent || linkedinDelivery.failed) console.info('[cron/retry-retrievals] LinkedIn delivery retry', linkedinDelivery);
  } catch (error) {
    console.error('[cron/retry-retrievals] LinkedIn delivery retry failed', {
      reason: error instanceof Error ? error.message.slice(0, 300) : 'Delivery worker failed unexpectedly.',
    });
    linkedinDelivery.failed += 1;
  }

  return jsonResponse({
    ok: true,
    recovered,
    recoveredExtractions,
    claimed: claimed.length,
    retentionDays,
    purged,
    results,
    linkedinDelivery,
  });
}

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    return await run(request, locals.env);
  } catch (error) {
    console.error('[cron/retry-retrievals] run failed', {
      reason: error instanceof Error ? error.message.slice(0, 300) : 'Recovery run failed.',
    });
    return jsonResponse(
      { error: error instanceof Error ? error.message.slice(0, 300) : 'Recovery run failed.' },
      500,
    );
  }
};

export const POST = GET;
