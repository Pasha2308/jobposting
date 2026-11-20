import type { APIRoute } from 'astro';
import { transitionOpportunity } from '../../../../../lib/services/publishing';
import { requireStore } from '../../../../../lib/services/context';
import { ServiceError } from '../../../../../lib/services/errors';
import { apiError, assertSameOrigin, jsonResponse, readJson } from '../../../../../lib/http';
import type { LifecycleAction } from '../../../../../lib/domain/lifecycle';
import { dispatchPortfolioDelivery } from '../../../../../lib/portfolio/linkedin-delivery';

const ACTIONS: LifecycleAction[] = [
  'submit_for_review',
  'approve',
  'publish',
  'close',
  'expire',
  'reopen',
  'reject',
  'archive',
  'restore',
];

export const POST: APIRoute = async (context) => {
  try {
    assertSameOrigin(context.request, context.locals.env);
    const store = requireStore(context.locals.env);
    const admin = context.locals.admin;
    if (!admin) throw new ServiceError('unauthorised', 'Sign in required.', 401);
    const id = context.params.id;
    if (!id) throw new ServiceError('not_found', 'Opportunity not found.', 404);

    const body = (await readJson(context.request)) as Record<string, unknown>;
    const action = String(body.action ?? '') as LifecycleAction;
    if (!ACTIONS.includes(action)) throw new ServiceError('invalid_action', 'Unknown status action.', 400);

    const result = await transitionOpportunity(store, id, action, `admin:${admin.email}`, context.locals.env.siteUrl);
    let delivery = null;
    let deliveryError: string | null = null;
    if (action === 'publish' || action === 'reopen') {
      try {
        delivery = await dispatchPortfolioDelivery(context.locals.env, store);
      } catch (error) {
        deliveryError = error instanceof Error ? error.message : 'Telegram delivery failed.';
      }
    }
    return jsonResponse({ ok: true, status: result.opportunity.status, warnings: result.warnings, delivery, deliveryError });
  } catch (error) {
    return apiError(error);
  }
};
