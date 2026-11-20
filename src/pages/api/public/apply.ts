import type { APIRoute } from 'astro';
import { apiError, assertSameOrigin, jsonResponse, readJson } from '../../../lib/http';
import { clientKey, rateLimit } from '../../../lib/rate-limit';
import { verifyTurnstile } from '../../../lib/turnstile';
import { requireStore } from '../../../lib/services/context';
import { recordCandidateApplication } from '../../../lib/services/candidate-apply';
import { ServiceError } from '../../../lib/services/errors';

function isForm(request: Request): boolean {
  const type = request.headers.get('content-type') ?? '';
  return type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data');
}

function redirect(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path, 'cache-control': 'no-store' } });
}

export const POST: APIRoute = async (context) => {
  const form = isForm(context.request);
  const env = context.locals.env;
  let jobCode = '';
  try {
    assertSameOrigin(context.request, env);
    const limited = rateLimit(clientKey(context.request, 'candidate-apply'), 5, 10 * 60_000);
    if (!limited.allowed) throw new ServiceError('rate_limited', 'Too many attempts. Please try again later.', 429);

    const body = (await readJson(context.request)) as Record<string, unknown>;
    jobCode = typeof body.job_code === 'string' && /^HC-\d{6,}$/i.test(body.job_code) ? body.job_code.toUpperCase() : '';
    if (!jobCode) throw new ServiceError('invalid_job', 'This job link is invalid.', 400);

    if (typeof body.website === 'string' && body.website.trim()) return redirect('/opportunities');
    const turnstile = await verifyTurnstile(
      typeof body['cf-turnstile-response'] === 'string' ? body['cf-turnstile-response'] : undefined,
      env.turnstileSecretKey,
      context.request.headers.get('cf-connecting-ip'),
    );
    if (!turnstile.ok) throw new ServiceError('turnstile_failed', turnstile.reason ?? 'Verification failed.', 400);

    const result = await recordCandidateApplication(
      requireStore(env),
      jobCode,
      typeof body.email === 'string' ? body.email : '',
      body.consent === 'yes' || body.consent === true,
    );
    if (form) return redirect(result.redirectTo);
    return jsonResponse({ ok: true, redirectTo: result.redirectTo }, 200);
  } catch (error) {
    if (form) {
      const message = error instanceof ServiceError ? error.message : 'We could not continue. Please try again.';
      return redirect(`/apply/${encodeURIComponent(jobCode)}?error=${encodeURIComponent(message)}`);
    }
    return apiError(error);
  }
};

export const GET: APIRoute = () => jsonResponse({ error: 'Method not allowed' }, 405);
