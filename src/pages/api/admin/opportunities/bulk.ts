import type { APIRoute } from 'astro';
import { bulkTransition } from '../../../../lib/services/publishing';
import { requireStore } from '../../../../lib/services/context';
import { ServiceError } from '../../../../lib/services/errors';
import { apiError, assertSameOrigin, jsonResponse, readJson } from '../../../../lib/http';
import type { LifecycleAction } from '../../../../lib/domain/lifecycle';
import { dispatchPortfolioDelivery } from '../../../../lib/portfolio/linkedin-delivery';

const ACTION_MAP: Record<string, LifecycleAction> = {
  submit_for_review: 'submit_for_review',
  publish: 'publish',
  close: 'close',
  archive: 'archive',
  reject: 'reject',
  restore: 'restore',
};

export const POST: APIRoute = async (context) => {
  try {
    assertSameOrigin(context.request, context.locals.env);
    const store = requireStore(context.locals.env);
    const admin = context.locals.admin;
    if (!admin) throw new ServiceError('unauthorised', 'Sign in required.', 401);

    const body = (await readJson(context.request)) as Record<string, unknown>;
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : [];
    const action = ACTION_MAP[String(body.action ?? '')];
    if (!ids.length) throw new ServiceError('no_selection', 'Select at least one opportunity.', 400);
    if (ids.length > 100) throw new ServiceError('too_many', 'Select at most 100 opportunities.', 400);
    if (!action) throw new ServiceError('invalid_action', 'Unknown bulk action.', 400);
    if (['close', 'archive', 'reject'].includes(action) && body.confirm !== true) {
      throw new ServiceError('confirm_required', 'Confirm this bulk action before continuing.', 400);
    }

    const result = await bulkTransition(store, ids, action, `admin:${admin.email}`, context.locals.env.siteUrl);
    let delivery = null;
    let deliveryError: string | null = null;
    if (action === 'publish' && result.succeeded.length) {
      try {
        delivery = await dispatchPortfolioDelivery(context.locals.env, store);
      } catch (error) {
        // Publishing and queue insertion already completed; report Telegram
        // delivery separately so an admin can retry without republishing.
        deliveryError = error instanceof Error ? error.message : 'Telegram delivery failed.';
      }
    }
    await store.logActivity({
      actor: `admin:${admin.email}`,
      action: `opportunities.bulk_${action}`,
      entity_type: 'opportunity',
      metadata: { succeeded: result.succeeded.length, failed: result.failed.length },
    });
    return jsonResponse({ ok: result.failed.length === 0, ...result, delivery, deliveryError });
  } catch (error) {
    return apiError(error);
  }
};
