import { describe, expect, it } from 'vitest';
import { processCapture, submitCapture } from '../../src/lib/services/capture';
import { publishOpportunity } from '../../src/lib/services/publishing';
import {
  createPublicReport,
  createPublicSubmission,
  markReportReviewing,
  resolveReport,
} from '../../src/lib/services/public';
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
  await publishOpportunity(store, processed.opportunity!.id, 'admin:test@example.com', SITE_URL);
  return { store, opportunity: processed.opportunity! };
}

describe('public submissions', () => {
  it('always stores a public submission as pending review', async () => {
    const { store } = await seedStore();
    const result = await createPublicSubmission(store, {
      source_url: 'https://example.com/careers/founding-marketer',
      role_title: 'Founding Marketer',
      company: 'Beta Studio',
      details:
        'Beta Studio is hiring a founding marketer to own content, lifecycle and community for an early-stage developer product.',
    });

    const capture = await store.getCapture(result.captureId);
    expect(capture?.status).toBe('received');
    expect(capture?.created_by).toBe('public');
    expect(capture?.source_type).toBe('public_submission');
    expect(store.opportunities).toHaveLength(0);
  });

  it('blocks a submission for an opportunity that is already listed', async () => {
    const { store, opportunity } = await publishedOpportunity();
    await expect(
      createPublicSubmission(store, {
        source_url: opportunity.source_url,
        role_title: 'Founding Full Stack Engineer',
        company: 'Acme Labs',
        details: 'This is the same role and should not create a duplicate submission record at all.',
      }),
    ).rejects.toMatchObject({ code: 'duplicate' });
  });

  it('rejects a submission with an invalid source URL', async () => {
    const { store } = await seedStore();
    await expect(
      createPublicSubmission(store, {
        source_url: 'javascript:alert(1)',
        details: 'A sufficiently long description that would otherwise pass the length requirement for this form.',
      }),
    ).rejects.toMatchObject({ code: 'invalid_url' });
  });
});

describe('public reports', () => {
  it('creates a report and resolves it with a note', async () => {
    const { store, opportunity } = await publishedOpportunity();
    const created = await createPublicReport(store, {
      opportunity_id: opportunity.id,
      reason: 'incorrect_info',
      details: 'The listed location does not match the original post.',
      contact_email: 'Reader@Example.com',
    });

    const report = await store.getReport(created.reportId);
    expect(report?.status).toBe('open');
    expect(report?.contact_email).toBe('reader@example.com');

    await markReportReviewing(store, created.reportId, 'admin:test@example.com');
    expect((await store.getReport(created.reportId))?.status).toBe('reviewing');

    const resolved = await resolveReport(store, created.reportId, 'resolve', {
      actor: 'admin:test@example.com',
      siteUrl: SITE_URL,
      note: 'Corrected the location against the source.',
    });
    expect(resolved.opportunityClosed).toBe(false);
    const finalReport = await store.getReport(created.reportId);
    expect(finalReport?.status).toBe('resolved');
    expect(finalReport?.resolution_note).toMatch(/corrected/i);
    expect(finalReport?.resolved_at).toBeTruthy();

    await expect(
      resolveReport(store, created.reportId, 'dismiss', { actor: 'admin:test@example.com', siteUrl: SITE_URL }),
    ).rejects.toMatchObject({ code: 'already_resolved' });
  });

  it('closes the listing when a closed-role report is resolved with close_job', async () => {
    const { store, opportunity } = await publishedOpportunity();
    const created = await createPublicReport(store, {
      opportunity_id: opportunity.id,
      reason: 'closed',
      details: 'The application page now returns a 404.',
    });

    const resolved = await resolveReport(store, created.reportId, 'close_job', {
      actor: 'admin:test@example.com',
      siteUrl: SITE_URL,
      note: 'Confirmed closed.',
    });
    expect(resolved.opportunityClosed).toBe(true);

    const updated = await store.getOpportunityById(opportunity.id);
    expect(updated?.status).toBe('closed');
    expect(updated?.closed_at).toBeTruthy();
    expect((await store.getReport(created.reportId))?.status).toBe('resolved');
  });

  it('rejects an invalid contact email rather than storing it', async () => {
    const { store, opportunity } = await publishedOpportunity();
    await expect(
      createPublicReport(store, {
        opportunity_id: opportunity.id,
        reason: 'broken_link',
        details: 'The apply button is broken.',
        contact_email: 'not-an-email',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(store.reports).toHaveLength(0);
  });

  it('rejects a report for a missing listing', async () => {
    const { store } = await seedStore();
    await expect(
      createPublicReport(store, {
        opportunity_id: '00000000-0000-4000-8000-000000000000',
        reason: 'other',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
