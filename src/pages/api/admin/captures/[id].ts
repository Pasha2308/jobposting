import type { APIRoute } from 'astro';
import { createAIProvider } from '../../../../lib/ai/gemini';
import { processCapture, rejectCapture, approveCapture } from '../../../../lib/services/capture';
import { requireStore } from '../../../../lib/services/context';
import { ServiceError } from '../../../../lib/services/errors';
import { apiError, assertSameOrigin, jsonResponse, readJson } from '../../../../lib/http';

export const POST: APIRoute = async (context) => {
  try {
    assertSameOrigin(context.request, context.locals.env);
    const store = requireStore(context.locals.env);
    const admin = context.locals.admin;
    const captureId = context.params.id;
    if (!admin) throw new ServiceError('unauthorised', 'Sign in required.', 401);
    if (!captureId) throw new ServiceError('not_found', 'Capture not found.', 404);

    const body = (await readJson(context.request)) as Record<string, unknown>;
    const action = String(body.action ?? 'retry');
    const actor = `admin:${admin.email}`;

    if (action === 'retry') {
      const ai = createAIProvider(context.locals.env);
      const result = await processCapture(store, ai, captureId, { actor, siteUrl: context.locals.env.siteUrl });
      return jsonResponse({
        ok: true,
        captureStatus: result.capture.status,
        opportunityId: result.opportunity?.id ?? null,
        reviewUrl: result.opportunity
          ? `/admin/opportunities/${result.opportunity.id}`
          : `/admin/captures/${captureId}`,
        genuine: result.genuine,
        warnings: result.warnings,
      });
    }
    if (action === 'reject') {
      const capture = await rejectCapture(store, captureId, actor, typeof body.note === 'string' ? body.note : undefined);
      return jsonResponse({ ok: true, captureStatus: capture.status });
    }
    if (action === 'approve') {
      const capture = await approveCapture(store, captureId, actor);
      return jsonResponse({ ok: true, captureStatus: capture.status });
    }
    throw new ServiceError('invalid_action', 'Unknown capture action.', 400);
  } catch (error) {
    return apiError(error);
  }
};
