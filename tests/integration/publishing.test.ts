import { describe, expect, it } from 'vitest';
import { processCapture, submitCapture } from '../../src/lib/services/capture';
import { bulkTransition, publishOpportunity, transitionOpportunity } from '../../src/lib/services/publishing';
import { trackPublicEvent } from '../../src/lib/services/public';
import { fakeAI, SAMPLE_TEXT, seedStore, SITE_URL } from '../helpers';

async function createPending(overrides: Record<string, unknown> = {}) {
  const { store } = await seedStore();
  const submitted = await submitCapture(store, {
    sourceUrl: 'https://www.linkedin.com/posts/acme_founder-engineer-1234567890',
    rawText: SAMPLE_TEXT,
    sourceType: 'linkedin_post',
    actor: 'admin:test@example.com',
  });
  const result = await processCapture(store, fakeAI(overrides), submitted.capture.id, {
    actor: 'admin:test@example.com',
    siteUrl: SITE_URL,
  });
  // ProcessCaptureResult now has opportunities[] array.
  return { store, opportunity: result.opportunities[0]!, captureId: submitted.capture.id };
}

describe('publication', () => {
  it('publishes through the validated gate and exposes the listing publicly', async () => {
    const { store, opportunity } = await createPending();
    expect(opportunity.status).toBe('pending_review');

    const result = await publishOpportunity(store, opportunity.id, 'admin:test@example.com', SITE_URL);
    expect(result.alreadyPublished).toBe(false);
    expect(result.opportunity.status).toBe('published');
    expect(result.opportunity.published_at).toBeTruthy();
    expect(result.listingUrl).toBe(`${SITE_URL}/opportunities/${opportunity.job_code ?? opportunity.slug}`);

    const publicSearch = await store.searchPublic({});
    expect(publicSearch.items.map((item) => item.id)).toContain(opportunity.id);

    // Regeneration keeps history; the latest version is the active set of three.
    const allComments = await store.listComments(opportunity.id);
    const latestVersion = Math.max(...allComments.map((comment) => comment.version));
    const comments = allComments.filter((comment) => comment.version === latestVersion);
    expect(comments).toHaveLength(3);
    expect(comments.every((comment) => comment.includes_listing_url)).toBe(true);
    expect(comments.every((comment) => comment.body.includes(result.listingUrl))).toBe(true);

    const capture = await store.getCapture(opportunity.source_capture_id!);
    expect(capture?.status).toBe('published');
  });

  it('is idempotent for an already-published listing', async () => {
    const { store, opportunity } = await createPending();
    await publishOpportunity(store, opportunity.id, 'admin:test@example.com', SITE_URL);
    const again = await publishOpportunity(store, opportunity.id, 'admin:test@example.com', SITE_URL);
    expect(again.alreadyPublished).toBe(true);
    expect(store.opportunities.filter((item) => item.id === opportunity.id)).toHaveLength(1);
  });

  it('blocks publication when no application route is usable', async () => {
    const { store, opportunity } = await createPending({
      application_method: 'none',
      application_url: null,
      recruitment_email: null,
      application_instructions: null,
    });

    await expect(
      publishOpportunity(store, opportunity.id, 'admin:test@example.com', SITE_URL),
    ).rejects.toMatchObject({ code: 'not_publishable', status: 422 });

    const still = await store.getOpportunityById(opportunity.id);
    expect(still?.status).toBe('pending_review');
    expect(still?.published_at).toBeNull();
  });

  it('closes a listing, removes it from public search and disables tracking', async () => {
    const { store, opportunity } = await createPending();
    await publishOpportunity(store, opportunity.id, 'admin:test@example.com', SITE_URL);

    await transitionOpportunity(store, opportunity.id, 'close', 'admin:test@example.com', SITE_URL);
    const closed = await store.getOpportunityById(opportunity.id);
    expect(closed?.status).toBe('closed');
    expect(closed?.closed_at).toBeTruthy();

    const publicSearch = await store.searchPublic({});
    expect(publicSearch.items.map((item) => item.id)).not.toContain(opportunity.id);

    const tracked = await trackPublicEvent(store, {
      opportunity_id: opportunity.id,
      event_type: 'apply_click',
    });
    expect(tracked.recorded).toBe(false);
  });

  it('records anonymous outbound clicks for live listings only', async () => {
    const { store, opportunity } = await createPending();
    await publishOpportunity(store, opportunity.id, 'admin:test@example.com', SITE_URL);

    const click = await trackPublicEvent(store, {
      opportunity_id: opportunity.id,
      event_type: 'apply_click',
    });
    expect(click.recorded).toBe(true);

    const search = await trackPublicEvent(store, { event_type: 'search', metadata: { query: 'founding engineer' } });
    expect(search.recorded).toBe(true);

    const events = store.events.filter((event) => event.event_type === 'apply_click');
    expect(events).toHaveLength(1);
    expect(events[0].opportunity_id).toBe(opportunity.id);
  });

  it('applies bulk transitions safely and reports failures per item', async () => {
    const { store, opportunity } = await createPending();
    const second = await submitCapture(store, {
      sourceUrl: 'https://www.linkedin.com/posts/acme_product-designer-9876543210',
      rawText: SAMPLE_TEXT.replace('Full Stack Engineer', 'Product Designer'),
      sourceType: 'linkedin_post',
      actor: 'admin:test@example.com',
    });
    await processCapture(store, fakeAI({ job_title: 'Product Designer' }), second.capture.id, {
      actor: 'admin:test@example.com',
      siteUrl: SITE_URL,
    });

    const result = await bulkTransition(
      store,
      [opportunity.id, 'missing-id'],
      'publish',
      'admin:test@example.com',
      SITE_URL,
    );
    expect(result.succeeded).toContain(opportunity.id);
    expect(result.failed.map((failure) => failure.id)).toContain('missing-id');
  });
});
