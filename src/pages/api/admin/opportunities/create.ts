import type { APIRoute } from 'astro';
import { createOpportunityManually } from '../../../../lib/services/admin-opportunity';
import { requireStore } from '../../../../lib/services/context';
import { ServiceError } from '../../../../lib/services/errors';
import { apiError, assertSameOrigin, jsonResponse, readJson } from '../../../../lib/http';

/** Manual draft creation. Publication is always a separate, validated action. */
export const POST: APIRoute = async (context) => {
  try {
    assertSameOrigin(context.request, context.locals.env);
    const store = requireStore(context.locals.env);
    const admin = context.locals.admin;
    if (!admin) throw new ServiceError('unauthorised', 'Sign in required.', 401);

    const body = await readJson(context.request);
    const result = await createOpportunityManually(store, body, {
      actor: `admin:${admin.email}`,
      siteUrl: context.locals.env.siteUrl,
    });
    return jsonResponse({ ok: true, opportunity: result.opportunity, warnings: result.warnings }, 201);
  } catch (error) {
    return apiError(error);
  }
};
