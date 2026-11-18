import type { APIRoute } from 'astro';
import { createPublicReport } from '../../../lib/services/public';
import { requireStore } from '../../../lib/services/context';
import { apiError, assertSameOrigin, jsonResponse, readJson } from '../../../lib/http';
import { clientKey, rateLimit } from '../../../lib/rate-limit';
import { verifyTurnstile } from '../../../lib/turnstile';
import { ServiceError } from '../../../lib/services/errors';

function isForm(request: Request): boolean {
  const type = request.headers.get('content-type') ?? '';
  return type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data');
}

function redirect(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}

export const POST: APIRoute = async (context) => {
  const form = isForm(context.request);
  const env = context.locals.env;
  try {
    assertSameOrigin(context.request, env);
    const limited = rateLimit(clientKey(context.request, 'public-report'), 5, 10 * 60_000);
    if (!limited.allowed) throw new ServiceError('rate_limited', 'Too many reports. Please try again later.', 429);

    const body = (await readJson(context.request)) as Record<string, unknown>;
    if (typeof body.honeypot === 'string' && body.honeypot.trim() !== '') {
      return form ? redirect('/report?submitted=1') : jsonResponse({ ok: true });
    }

    const turnstile = await verifyTurnstile(
      typeof body.turnstile_token === 'string' ? body.turnstile_token : undefined,
      env.turnstileSecretKey,
      context.request.headers.get('cf-connecting-ip'),
    );
    if (!turnstile.ok) throw new ServiceError('turnstile_failed', turnstile.reason ?? 'Verification failed.', 400);

    const store = requireStore(env);
    const settings = await store.getSettings();
    if (!settings.reports_enabled) throw new ServiceError('reports_disabled', 'Reporting is temporarily closed.', 503);

    const result = await createPublicReport(store, body);
    if (form) return redirect('/report?submitted=1');
    return jsonResponse({ ok: true, ...result }, 201);
  } catch (error) {
    if (form) {
      const message = error instanceof ServiceError ? error.message : 'Report failed. Please try again.';
      return redirect(`/report?error=${encodeURIComponent(message)}`);
    }
    return apiError(error);
  }
};

export const GET: APIRoute = () => jsonResponse({ error: 'Method not allowed' }, 405);
