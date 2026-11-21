import type { APIRoute } from 'astro';
import { apiError, assertSameOrigin, jsonResponse, readJson } from '../../../../lib/http';
import { clientKey, rateLimit } from '../../../../lib/rate-limit';
import { verifyTurnstile } from '../../../../lib/turnstile';
import { requireStore } from '../../../../lib/services/context';
import { startCandidateEmailVerification } from '../../../../lib/services/candidate-apply';
import { ServiceError } from '../../../../lib/services/errors';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    assertSameOrigin(request, locals.env);
    const limited = rateLimit(clientKey(request, 'candidate-otp-start'), 5, 60 * 60_000);
    if (!limited.allowed) throw new ServiceError('rate_limited', 'Too many verification requests. Please wait before trying again.', 429);
    const body = (await readJson(request)) as Record<string, unknown>;
    const jobCode = typeof body.job_code === 'string' && /^HC-\d{6,}$/i.test(body.job_code) ? body.job_code.toUpperCase() : '';
    if (!jobCode) throw new ServiceError('invalid_job', 'This job link is invalid.', 400);
    if (typeof body.website === 'string' && body.website.trim()) return jsonResponse({ ok: true }, 200);
    const turnstile = await verifyTurnstile(
      typeof body['cf-turnstile-response'] === 'string' ? body['cf-turnstile-response'] : undefined,
      locals.env.turnstileSecretKey,
      request.headers.get('cf-connecting-ip'),
    );
    if (!turnstile.ok) throw new ServiceError('turnstile_failed', turnstile.reason ?? 'Verification failed.', 400);
    await startCandidateEmailVerification(
      requireStore(locals.env), locals.env, jobCode,
      typeof body.email === 'string' ? body.email : '',
      body.consent === 'yes' || body.consent === true,
      request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
    );
    return jsonResponse({ ok: true, message: 'If the address is valid, a verification code has been sent.' }, 200);
  } catch (error) { return apiError(error); }
};

export const GET: APIRoute = () => jsonResponse({ error: 'Method not allowed' }, 405);
