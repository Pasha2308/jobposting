import type { APIRoute } from 'astro';
import { markReportReviewing, resolveReport, type ReportResolutionAction } from '../../../../lib/services/public';
import { requireStore } from '../../../../lib/services/context';
import { ServiceError } from '../../../../lib/services/errors';
import { apiError, assertSameOrigin, jsonResponse, readJson } from '../../../../lib/http';

const ACTIONS: ReportResolutionAction[] = ['dismiss', 'resolve', 'close_job'];

export const POST: APIRoute = async (context) => {
  try {
    assertSameOrigin(context.request, context.locals.env);
    const store = requireStore(context.locals.env);
    const admin = context.locals.admin;
    if (!admin) throw new ServiceError('unauthorised', 'Sign in required.', 401);
    const id = context.params.id;
    if (!id) throw new ServiceError('not_found', 'Report not found.', 404);

    const body = (await readJson(context.request)) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const actor = `admin:${admin.email}`;

    if (action === 'review') {
      await markReportReviewing(store, id, actor);
      return jsonResponse({ ok: true, status: 'reviewing' });
    }
    if (!ACTIONS.includes(action as ReportResolutionAction)) {
      throw new ServiceError('invalid_action', 'Unknown report action.', 400);
    }
    const result = await resolveReport(store, id, action as ReportResolutionAction, {
      actor,
      siteUrl: context.locals.env.siteUrl,
      note: typeof body.note === 'string' ? body.note : undefined,
    });
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return apiError(error);
  }
};
