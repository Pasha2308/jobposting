import type { APIRoute } from 'astro';
import { trackPublicEvent } from '../../../lib/services/public';
import { requireStore } from '../../../lib/services/context';
import { apiError, jsonResponse, readJson } from '../../../lib/http';
import { rateLimit } from '../../../lib/rate-limit';
import { ServiceError } from '../../../lib/services/errors';

export const POST: APIRoute = async (context) => {
  try {
    const limited = rateLimit(
      `public-track:${context.request.headers.get('cf-connecting-ip') ?? 'unknown'}`,
      120,
      60_000,
    );
    if (!limited.allowed) throw new ServiceError('rate_limited', 'Too many events.', 429);
    const store = requireStore(context.locals.env);
    const body = await readJson(context.request);
    const result = await trackPublicEvent(store, body);
    return jsonResponse({ ok: true, recorded: result.recorded }, 202);
  } catch (error) {
    return apiError(error);
  }
};
