import type { APIRoute } from 'astro';
import type { AppEnv } from '../../../lib/env';
import { createAIProvider } from '../../../lib/ai';
import { createRetrievalService } from '../../../lib/linkedin/jsonld';
import { requireStore } from '../../../lib/services/context';
import { retryRetrieval } from '../../../lib/services/ingest-source';
import { jsonResponse } from '../../../lib/http';

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

  const recovered = await store.recoverStaleRetrieving(120).catch(() => 0);
  const recoveredExtractions = await store.recoverStaleExtracting(30 * 60).catch(() => 0);
  const claimed = await store.claimDueRetrievals(5).catch(() => []);
  const settings = await store.getSettings().catch(() => null);
  const retentionDays = settings?.source_retention_days ?? 90;
  const purged = await store.purgeExpiredSourceText(retentionDays).catch(() => 0);

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
    } catch (error) {
      results.push({
        captureId: capture.id,
        ok: false,
        errorCode: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
      });
    }
  }

  return jsonResponse({
    ok: true,
    recovered,
    recoveredExtractions,
    claimed: claimed.length,
    retentionDays,
    purged,
    results,
  });
}

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    return await run(request, locals.env);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message.slice(0, 300) : 'Recovery run failed.' },
      500,
    );
  }
};

export const POST = GET;
