import type { APIRoute } from 'astro';
import { signInAdmin, setSessionCookies } from '../../../lib/auth';
import { apiError, assertSameOrigin, isSecureRequest, jsonResponse, readJson, safeNextPath } from '../../../lib/http';
import { ServiceError } from '../../../lib/services/errors';
import { clientKey, rateLimit } from '../../../lib/rate-limit';

function redirect(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}

export const POST: APIRoute = async (context) => {
  const isJson = (context.request.headers.get('content-type') ?? '').includes('application/json');
  try {
    assertSameOrigin(context.request, context.locals.env);
    const limited = rateLimit(clientKey(context.request, 'login'), 10, 15 * 60_000);
    if (!limited.allowed) {
      throw new ServiceError('rate_limited', 'Too many sign-in attempts. Try again in a few minutes.', 429);
    }

    const body = (await readJson(context.request)) as Record<string, unknown>;
    const email = String(body.email ?? '').trim();
    const password = String(body.password ?? '');
    const next = safeNextPath(typeof body.next === 'string' ? body.next : null);

    if (!email || !password) {
      throw new ServiceError('invalid_credentials', 'Enter your email and password.', 400);
    }
    if (password.length > 200 || email.length > 254) {
      throw new ServiceError('invalid_credentials', 'Enter your email and password.', 400);
    }

    const result = await signInAdmin(context.locals.env, email, password);
    setSessionCookies(context.cookies, result.tokens, isSecureRequest(context.request));
    if (isJson) return jsonResponse({ ok: true, redirect: next });
    return redirect(next);
  } catch (error) {
    if (isJson) return apiError(error);
    const message = error instanceof ServiceError ? error.message : 'Sign-in failed.';
    const next = new URL(context.request.url).searchParams.get('next');
    const query = new URLSearchParams({ error: message });
    if (next) query.set('next', next);
    return redirect(`/admin/login?${query.toString()}`);
  }
};

export const GET: APIRoute = () => jsonResponse({ error: 'Method not allowed' }, 405);
