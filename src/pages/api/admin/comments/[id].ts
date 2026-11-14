import type { APIRoute } from 'astro';
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
    if (!id) throw new ServiceError('not_found', 'Comment not found.', 404);

    const existing = await store.getComment(id);
    if (!existing) throw new ServiceError('not_found', 'Comment not found.', 404);

    const body = (await readJson(context.request)) as Record<string, unknown>;
    const patch: { body?: string; is_selected?: boolean; manually_posted?: boolean } = {};
    if (typeof body.body === 'string') {
      const text = body.body.trim();
      if (!text) throw new ServiceError('invalid_comment', 'Comment cannot be empty.', 400);
      if (text.length > 2000) throw new ServiceError('invalid_comment', 'Comment must be under 2,000 characters.', 400);
      patch.body = text;
    }
    if (typeof body.is_selected === 'boolean') patch.is_selected = body.is_selected;
    if (typeof body.manually_posted === 'boolean') patch.manually_posted = body.manually_posted;
    if (!Object.keys(patch).length) throw new ServiceError('no_changes', 'Nothing to update.', 400);

    const comment = await store.updateComment(id, patch);
    if (patch.manually_posted !== undefined) {
      await store.logActivity({
        actor: `admin:${admin.email}`,
        action: patch.manually_posted ? 'comment.marked_posted' : 'comment.marked_not_posted',
        entity_type: 'generated_comment',
        entity_id: id,
        metadata: { opportunity_id: existing.opportunity_id },
      });
    }
    return jsonResponse({ ok: true, comment });
  } catch (error) {
    return apiError(error);
  }
};
