import { describe, expect, it } from 'vitest';
import { buildLinkedInDraft } from '../../src/lib/portfolio/linkedin-draft';
import { buildXDraft } from '../../src/lib/portfolio/x-draft';
import { publishOpportunity } from '../../src/lib/services/publishing';
import { processCapture, submitCapture } from '../../src/lib/services/capture';
import { fakeAI, SAMPLE_TEXT, seedStore, SITE_URL } from '../helpers';

async function opportunity() {
  const { store } = await seedStore();
  const capture = await submitCapture(store, { sourceUrl: 'https://www.linkedin.com/posts/acme_hiring-1234567890', rawText: SAMPLE_TEXT, sourceType: 'linkedin_post', actor: 'test' });
  const processed = await processCapture(store, fakeAI(), capture.capture.id, { actor: 'test', siteUrl: SITE_URL });
  return (await publishOpportunity(store, processed.opportunities[0]!.id, 'test', SITE_URL)).opportunity;
}

describe('platform social drafts', () => {
  it('creates a scannable LinkedIn hiring post below the official limit', async () => {
    const job = await opportunity();
    const url = `${SITE_URL}/opportunities/${job.job_code}`;
    const draft = buildLinkedInDraft(job, url);
    expect(draft.startsWith('🔎 LOOKING FOR A FOUNDING FULL STACK ENGINEER ROLE?')).toBe(true);
    expect(draft).toContain('Here are the details:');
    expect(draft).toContain(url);
    expect(draft.length).toBeLessThanOrEqual(3000);
  });

  it('keeps a free-account X post and its full link within 280 characters', async () => {
    const job = await opportunity();
    const url = `${SITE_URL}/opportunities/${job.job_code}`;
    const draft = buildXDraft(job, url);
    expect(draft).toContain(url);
    expect(draft).toContain('#Hiring #Jobs');
    expect(draft.length).toBeLessThanOrEqual(280);
  });
});
