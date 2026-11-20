import type { Opportunity, OpportunityWithRelations } from '../domain/types';
import { checkTransition, type LifecycleAction } from '../domain/lifecycle';
import { validateForPublication } from '../domain/validation';
import type { Store } from '../store/types';
import { refreshComments } from './comments';
import { ServiceError } from './errors';
import { opportunityPublicId } from '../domain/url';
import { buildLinkedInDraft } from '../portfolio/linkedin-draft';

export { ServiceError };

export type PublishResult = {
  opportunity: OpportunityWithRelations;
  alreadyPublished: boolean;
  warnings: string[];
  listingUrl: string;
};

/**
 * The single publication service used by the admin UI, admin API and Telegram
 * approval callbacks. Publication always revalidates the record; the database
 * trigger is a second line of defence.
 */
export async function publishOpportunity(
  store: Store,
  opportunityId: string,
  actor: string,
  siteUrl: string,
): Promise<PublishResult> {
  const opportunity = await store.getOpportunityById(opportunityId);
  if (!opportunity) throw new ServiceError('not_found', 'Opportunity not found.', 404);

  if (opportunity.status === 'published' && opportunity.published_at && !opportunity.closed_at) {
    return {
      opportunity,
      alreadyPublished: true,
      warnings: ['This opportunity is already published.'],
      listingUrl: `${siteUrl.replace(/\/+$/, '')}/opportunities/${opportunityPublicId(opportunity)}`,
    };
  }

  const transition = checkTransition(opportunity.status, opportunity.status === 'closed' || opportunity.status === 'expired' ? 'reopen' : 'publish');
  if (!transition.ok) throw new ServiceError('invalid_transition', transition.reason, 409);

  const validation = validateForPublication(
    opportunity,
    opportunity.company?.name ?? null,
    opportunity.category?.name ?? null,
  );
  if (!validation.ok) {
    throw new ServiceError('not_publishable', 'This opportunity is missing information required for publication.', 422, {
      blocking: validation.blocking,
      warnings: validation.warnings,
    });
  }

  const publicUrl = `${siteUrl.replace(/\/+$/, '')}/opportunities/${opportunityPublicId(opportunity)}`;
  const postDraft = buildLinkedInDraft(opportunity, publicUrl);
  const updated = await store.updateOpportunity(opportunity.id, {
    status: 'published',
    published_at: opportunity.published_at ?? new Date().toISOString(),
    closed_at: null,
    linkedin_post_draft: postDraft,
  });

  const withRelations = { ...updated, company: opportunity.company, category: opportunity.category } as OpportunityWithRelations;
  await refreshComments(store, withRelations, siteUrl).catch((error) => {
    // Comments are not a publication blocker.
    console.error('comment generation failed', error instanceof Error ? error.message : error);
  });

  if (opportunity.source_capture_id) {
    await store
      .updateCapture(opportunity.source_capture_id, { status: 'published' })
      .catch(() => undefined);
  }

  await store.enqueueLinkedInPost(opportunity.id);

  await store.logActivity({
    actor,
    action: 'opportunity.published',
    entity_type: 'opportunity',
    entity_id: opportunity.id,
    metadata: { title: opportunity.title, previously: opportunity.status },
  });

  return {
    opportunity: withRelations,
    alreadyPublished: false,
    warnings: validation.warnings,
    listingUrl: `${siteUrl.replace(/\/+$/, '')}/opportunities/${opportunityPublicId(opportunity)}`,
  };
}

export type TransitionResult = { opportunity: OpportunityWithRelations; warnings: string[] };

export async function transitionOpportunity(
  store: Store,
  opportunityId: string,
  action: LifecycleAction,
  actor: string,
  siteUrl: string,
): Promise<TransitionResult> {
  if (action === 'publish' || action === 'reopen') {
    const result = await publishOpportunity(store, opportunityId, actor, siteUrl);
    return { opportunity: result.opportunity, warnings: result.warnings };
  }

  const opportunity = await store.getOpportunityById(opportunityId);
  if (!opportunity) throw new ServiceError('not_found', 'Opportunity not found.', 404);

  const transition = checkTransition(opportunity.status, action);
  if (!transition.ok) throw new ServiceError('invalid_transition', transition.reason, 409);

  const patch: Partial<Opportunity> = { status: transition.next };
  if (action === 'close' || action === 'expire') patch.closed_at = new Date().toISOString();
  if (action === 'restore' || action === 'submit_for_review' || action === 'approve') patch.closed_at = null;
  if (action === 'approve') patch.status = 'pending_review';

  const updated = await store.updateOpportunity(opportunity.id, patch);
  await store.logActivity({
    actor,
    action: `opportunity.${action}`,
    entity_type: 'opportunity',
    entity_id: opportunity.id,
    metadata: { from: opportunity.status, to: updated.status },
  });

  return {
    opportunity: { ...updated, company: opportunity.company, category: opportunity.category } as OpportunityWithRelations,
    warnings: [],
  };
}

export async function bulkTransition(
  store: Store,
  ids: string[],
  action: LifecycleAction,
  actor: string,
  siteUrl: string,
): Promise<{ succeeded: string[]; failed: { id: string; reason: string }[] }> {
  const succeeded: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const id of ids.slice(0, 100)) {
    try {
      await transitionOpportunity(store, id, action, actor, siteUrl);
      succeeded.push(id);
    } catch (error) {
      failed.push({ id, reason: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
  return { succeeded, failed };
}
