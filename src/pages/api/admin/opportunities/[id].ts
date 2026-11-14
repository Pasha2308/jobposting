import type { APIRoute } from 'astro';
import { saveOpportunity } from '../../../../lib/services/admin-opportunity';
import { requireStore } from '../../../../lib/services/context';
import { ServiceError } from '../../../../lib/services/errors';
import { apiError, assertSameOrigin, jsonResponse, readJson } from '../../../../lib/http';

export const POST: APIRoute = async (context) => {
  try {
    assertSameOrigin(context.request, context.locals.env);
    const store = requireStore(context.locals.env);
    const admin = context.locals.admin;
    if (!admin) throw new ServiceError('unauthorised', 'Sign in required.', 401);
    const id = context.params.id;
    if (!id) throw new ServiceError('not_found', 'Opportunity not found.', 404);
    const body = await readJson(context.request);
    const result = await saveOpportunity(store, id, body, {
      actor: `admin:${admin.email}`,
      siteUrl: context.locals.env.siteUrl,
    });
    return jsonResponse({ ok: true, opportunity: result.opportunity, warnings: result.warnings });
  } catch (error) {
    return apiError(error);
  }
};
