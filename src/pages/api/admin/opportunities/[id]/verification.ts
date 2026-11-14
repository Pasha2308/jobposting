import type { APIRoute } from 'astro';
import { setVerification } from '../../../../../lib/services/admin-opportunity';
import { requireStore } from '../../../../../lib/services/context';
import { ServiceError } from '../../../../../lib/services/errors';
import { apiError, assertSameOrigin, jsonResponse, readJson } from '../../../../../lib/http';
import type { VerificationStatus } from '../../../../../lib/domain/types';

const STATUSES: VerificationStatus[] = ['not_verified', 'source_open', 'source_closed', 'uncertain', 'needs_verification'];

export const POST: APIRoute = async (context) => {
  try {
    assertSameOrigin(context.request, context.locals.env);
    const store = requireStore(context.locals.env);
    const admin = context.locals.admin;
    if (!admin) throw new ServiceError('unauthorised', 'Sign in required.', 401);
    const id = context.params.id;
    if (!id) throw new ServiceError('not_found', 'Opportunity not found.', 404);

    const body = (await readJson(context.request)) as Record<string, unknown>;
    const status = String(body.status ?? '') as VerificationStatus;
    if (!STATUSES.includes(status)) throw new ServiceError('invalid_status', 'Unknown verification status.', 400);
    const opportunity = await setVerification(store, id, status, `admin:${admin.email}`);
    return jsonResponse({ ok: true, verification_status: opportunity.verification_status });
  } catch (error) {
    return apiError(error);
  }
};
