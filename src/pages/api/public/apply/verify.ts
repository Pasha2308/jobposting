import type { APIRoute } from 'astro';
import { apiError, assertSameOrigin, jsonResponse, readJson } from '../../../../lib/http';
import { clientKey, rateLimit } from '../../../../lib/rate-limit';
import { requireStore } from '../../../../lib/services/context';
import { completeCandidateEmailVerification } from '../../../../lib/services/candidate-apply';
import { ServiceError } from '../../../../lib/services/errors';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    assertSameOrigin(request, locals.env);
    const limited = rateLimit(clientKey(request, 'candidate-otp-verify'), 10, 10 * 60_000);
    if (!limited.allowed) throw new ServiceError('rate_limited', 'Too many attempts. Please wait before trying again.', 429);
    const body = (await readJson(request)) as Record<string, unknown>;
    const jobCode = typeof body.job_code === 'string' && /^HC-\d{6,}$/i.test(body.job_code) ? body.job_code.toUpperCase() : '';
    if (!jobCode) throw new ServiceError('invalid_job', 'This job link is invalid.', 400);
    const result = await completeCandidateEmailVerification(
      requireStore(locals.env), locals.env, jobCode,
      typeof body.email === 'string' ? body.email : '',
      typeof body.code === 'string' ? body.code : '',
    );
    return jsonResponse({ ok: true, redirectTo: result.redirectTo }, 200);
  } catch (error) { return apiError(error); }
};

export const GET: APIRoute = () => jsonResponse({ error: 'Method not allowed' }, 405);
