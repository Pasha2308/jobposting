import type { Opportunity, OpportunityWithRelations } from '../domain/types';
import { generateComments } from '../domain/comments';
import type { Store } from '../store/types';

export type CommentRefreshResult = {
  comments: Awaited<ReturnType<Store['replaceComments']>>;
  listingUrl: string | null;
};

/**
 * Regenerates the three comment variants for an opportunity. The public URL is
 * only inserted after publication, never before.
 */
export async function refreshComments(
  store: Store,
  opportunity: OpportunityWithRelations,
  siteUrl: string,
): Promise<CommentRefreshResult> {
  const companyName =
    opportunity.company?.name ??
    (opportunity.company_id ? (await store.getCompanyById(opportunity.company_id))?.name : null) ??
    'the company';
  const categoryName =
    opportunity.category?.name ??
    (opportunity.category_id ? (await store.getCategoryById(opportunity.category_id))?.name : null) ??
    null;

  const isPublished = opportunity.status === 'published' && Boolean(opportunity.published_at);
  const listingUrl = `${siteUrl.replace(/\/+$/, '')}/opportunities/${opportunity.slug}`;
  const sets = generateComments({
    title: opportunity.title,
    companyName,
    categoryName,
    location: opportunity.city ?? opportunity.location_text,
    isRemote: opportunity.work_mode === 'remote',
    isInternship: opportunity.employment_type === 'internship',
    listingUrl,
    isPublished,
  });

  const comments = await store.replaceComments(opportunity.id, sets, {
    generatedBy: 'template',
    selectedStyle: 'professional',
  });

  return { comments, listingUrl: isPublished ? listingUrl : null };
}

export function publicListingUrl(siteUrl: string, slug: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/opportunities/${slug}`;
}

export function opportunityIsLive(opportunity: Pick<Opportunity, 'status' | 'published_at' | 'closed_at' | 'deadline'>): boolean {
  if (opportunity.status !== 'published' || opportunity.closed_at || !opportunity.published_at) return false;
  if (opportunity.deadline) {
    const deadline = Date.parse(`${opportunity.deadline}T23:59:59.999Z`);
    if (Number.isFinite(deadline) && deadline < Date.now()) return false;
  }
  return true;
}
