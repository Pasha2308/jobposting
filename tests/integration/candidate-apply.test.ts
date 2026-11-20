import { describe, expect, it } from 'vitest';
import { recordCandidateApplication } from '../../src/lib/services/candidate-apply';
import { processCapture, submitCapture } from '../../src/lib/services/capture';
import { publishOpportunity } from '../../src/lib/services/publishing';
import { buildLinkedInDraft } from '../../src/lib/portfolio/linkedin-draft';
import { fakeAI, SAMPLE_TEXT, seedStore, SITE_URL } from '../helpers';

async function publishedOpportunity() {
  const { store } = await seedStore();
  const submitted = await submitCapture(store, {
    sourceUrl: 'https://www.linkedin.com/posts/acme_founder-engineer-1234567890',
    rawText: SAMPLE_TEXT,
    sourceType: 'linkedin_post',
    actor: 'admin:test@example.com',
  });
  const processed = await processCapture(store, fakeAI(), submitted.capture.id, {
    actor: 'admin:test@example.com',
    siteUrl: SITE_URL,
  });
  const opportunity = (await publishOpportunity(store, processed.opportunities[0]!.id, 'admin:test@example.com', SITE_URL)).opportunity;
  return { store, opportunity };
}

describe('candidate apply capture and redirect', () => {
  it('creates clean LinkedIn copy from legacy escaped job descriptions', async () => {
    const { store, opportunity } = await publishedOpportunity();
    await store.updateOpportunity(opportunity.id, {
      summary: '&lt;div&gt;&lt;p&gt;Acme Labs is hiring a founding engineer to build useful software with the team.&lt;/p&gt;&lt;/div&gt;',
    });
    const legacy = await store.getOpportunityById(opportunity.id);
    expect(legacy).toBeTruthy();
    const draft = buildLinkedInDraft(legacy!, `${SITE_URL}/opportunities/${opportunity.job_code}`);
    expect(draft).toContain('Acme Labs is hiring a founding engineer');
    expect(draft).toContain(`${SITE_URL}/opportunities/${opportunity.job_code}`);
    expect(draft).not.toMatch(/&lt;|<\/?(?:div|p)>/i);
  });

  it('records consent once and returns the verified employer route', async () => {
    const { store, opportunity } = await publishedOpportunity();
    const first = await recordCandidateApplication(store, opportunity.job_code!, '  Candidate@Example.com ', true);
    expect(first.redirectTo).toBe('https://acme.test/careers/founding-engineer');
    expect(store.candidateApplications).toHaveLength(1);
    expect(store.candidateApplications[0]?.email).toBe('candidate@example.com');
    expect(store.candidateApplications[0]?.opportunity_id).toBe(opportunity.id);

    const second = await recordCandidateApplication(store, opportunity.job_code!, 'candidate@example.com', true);
    expect(second.redirectTo).toBe(first.redirectTo);
    expect(store.candidateApplications).toHaveLength(1);
  });

  it('requires explicit consent and does not store the email without it', async () => {
    const { store, opportunity } = await publishedOpportunity();
    await expect(recordCandidateApplication(store, opportunity.job_code!, 'candidate@example.com', false))
      .rejects.toMatchObject({ code: 'consent_required' });
    expect(store.candidateApplications).toHaveLength(0);
  });

  it('refuses closed opportunities before recording or redirecting', async () => {
    const { store, opportunity } = await publishedOpportunity();
    await store.updateOpportunity(opportunity.id, { status: 'closed', closed_at: new Date().toISOString() });
    await expect(recordCandidateApplication(store, opportunity.job_code!, 'candidate@example.com', true))
      .rejects.toMatchObject({ code: 'job_unavailable' });
    expect(store.candidateApplications).toHaveLength(0);
  });
});
