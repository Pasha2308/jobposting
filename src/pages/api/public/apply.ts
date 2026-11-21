import type { APIRoute } from 'astro';
import { assertSameOrigin, jsonResponse } from '../../../lib/http';

/** Legacy one-step email capture is intentionally closed: only OTP verification may store candidate email. */
export const POST: APIRoute = ({ request, locals }) => {
  assertSameOrigin(request, locals.env);
  return jsonResponse({ error: 'Email verification is required before continuing.' }, 410);
};

export const GET: APIRoute = () => jsonResponse({ error: 'Method not allowed' }, 405);
