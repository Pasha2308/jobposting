import type { APIRoute } from 'astro';
import { requireStore } from '../../../../../lib/services/context';
import { ServiceError } from '../../../../../lib/services/errors';
import { apiError, assertSameOrigin, jsonResponse } from '../../../../../lib/http';
import { refreshComments } from '../../../../../lib/services/comments';

export const POST: APIRoute = async (context) => {
  try {
    assertSameOrigin(context.request, context.locals.env);
    const store = requireStore(context.locals.env);
    const admin = context.locals.admin;
    if (!admin) throw new ServiceError('unauthorised', 'Sign in required.', 401);
    const id = context.params.id;
    if (!id) throw new ServiceError('not_found', 'Opportunity not found.', 404);

    const opportunity = await store.getOpportunityById(id);
    if (!opportunity) throw new ServiceError('not_found', 'Opportunity not found.', 404);
    const result = await refreshComments(store, opportunity, context.locals.env.siteUrl);
    await store.logActivity({
      actor: `admin:${admin.email}`,
      action: 'comments.regenerated',
      entity_type: 'opportunity',
      entity_id: id,
    });
    return jsonResponse({ ok: true, comments: result.comments, listingUrl: result.listingUrl });
  } catch (error) {
    return apiError(error);
  }
};
