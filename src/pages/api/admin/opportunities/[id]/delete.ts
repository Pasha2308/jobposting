import type { APIRoute } from 'astro';
import { requireStore } from '../../../../../lib/services/context';
import { ServiceError } from '../../../../../lib/services/errors';
import { apiError, assertSameOrigin, jsonResponse, readJson } from '../../../../../lib/http';

export const POST: APIRoute = async (context) => {
  try {
    assertSameOrigin(context.request, context.locals.env);
    const store = requireStore(context.locals.env);
    const admin = context.locals.admin;
    if (!admin) throw new ServiceError('unauthorised', 'Sign in required.', 401);
    const id = context.params.id;
    if (!id) throw new ServiceError('not_found', 'Opportunity not found.', 404);

    const body = (await readJson(context.request)) as Record<string, unknown>;
    if (body.confirm !== 'DELETE') {
      throw new ServiceError('confirm_required', 'Type DELETE to confirm permanent deletion.', 400);
    }
    const opportunity = await store.getOpportunityById(id);
    if (!opportunity) throw new ServiceError('not_found', 'Opportunity not found.', 404);
    if (opportunity.source_capture_id) {
      await store.updateCapture(opportunity.source_capture_id, { opportunity_id: null }).catch(() => undefined);
    }
    await store.deleteOpportunity(id);
    await store.logActivity({
      actor: `admin:${admin.email}`,
      action: 'opportunity.deleted',
      entity_type: 'opportunity',
      entity_id: id,
      metadata: { title: opportunity.title, status: opportunity.status },
    });
    return jsonResponse({ ok: true });
  } catch (error) {
    return apiError(error);
  }
};
