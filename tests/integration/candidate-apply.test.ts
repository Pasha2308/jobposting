import { describe, expect, it, vi } from 'vitest';
import { completeCandidateEmailVerification, startCandidateEmailVerification } from '../../src/lib/services/candidate-apply';
import { processCapture, submitCapture } from '../../src/lib/services/capture';
import { publishOpportunity } from '../../src/lib/services/publishing';
import { buildLinkedInDraft } from '../../src/lib/portfolio/linkedin-draft';
import { fakeAI, SAMPLE_TEXT, seedStore, SITE_URL } from '../helpers';
import { resolveEnv } from '../../src/lib/env';

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

  it('stores no email before verification, then records one verified address and redirects', async () => {
    const { store, opportunity } = await publishedOpportunity();
    const env = resolveEnv({ RESEND_API_KEY: 'test-api-key', CANDIDATE_EMAIL_FROM: 'jobs@verified.example', CANDIDATE_EMAIL_OTP_SECRET: 'test-only-secret-with-enough-entropy' });
    let sentCode = '';
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { text: string };
      sentCode = body.text.match(/code is (\d{6})/)?.[1] ?? '';
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await startCandidateEmailVerification(store, env, opportunity.job_code!, '  Candidate@Example.com ', true, '127.0.0.1');
      expect(store.candidateApplications).toHaveLength(0);
      expect(store.candidateOtps.size).toBe(1);
      const first = await completeCandidateEmailVerification(store, env, opportunity.job_code!, 'candidate@example.com', sentCode);
      expect(first.redirectTo).toBe('https://acme.test/careers/founding-engineer');
      expect(store.candidateApplications).toHaveLength(1);
      expect(store.candidateApplications[0]?.email).toBe('candidate@example.com');
      expect(store.candidateApplications[0]?.opportunity_id).toBe(opportunity.id);
      expect(store.candidateApplications[0]?.verified_at).toBeTruthy();
      expect(store.candidateOtps.size).toBe(0);
      await expect(completeCandidateEmailVerification(store, env, opportunity.job_code!, 'candidate@example.com', sentCode))
        .rejects.toMatchObject({ code: 'verification_failed' });
      expect(store.candidateApplications).toHaveLength(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it('rejects wrong and expired codes without saving an email', async () => {
    const { store, opportunity } = await publishedOpportunity();
    const env = resolveEnv({ RESEND_API_KEY: 'test-api-key', CANDIDATE_EMAIL_FROM: 'jobs@verified.example', CANDIDATE_EMAIL_OTP_SECRET: 'test-only-secret-with-enough-entropy' });
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await startCandidateEmailVerification(store, env, opportunity.job_code!, 'candidate@example.com', true, '127.0.0.1');
      await expect(completeCandidateEmailVerification(store, env, opportunity.job_code!, 'candidate@example.com', '123456'))
        .rejects.toMatchObject({ code: 'verification_failed' });
      expect(store.candidateApplications).toHaveLength(0);
      const pending = [...store.candidateOtps.values()][0]!;
      const expiredNow = new Date(Date.parse(pending.expires_at) + 1);
      await expect(completeCandidateEmailVerification(store, env, opportunity.job_code!, 'candidate@example.com', '123456', expiredNow))
        .rejects.toMatchObject({ code: 'verification_failed' });
      expect(store.candidateApplications).toHaveLength(0);
    } finally { vi.unstubAllGlobals(); }
  });

  it('rate limits email sends and does not deliver when the provider rejects the request', async () => {
    const { store, opportunity } = await publishedOpportunity();
    const env = resolveEnv({ RESEND_API_KEY: 'test-api-key', CANDIDATE_EMAIL_FROM: 'jobs@verified.example', CANDIDATE_EMAIL_OTP_SECRET: 'test-only-secret-with-enough-entropy' });
    const providerFailure = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', providerFailure);
    try {
      await expect(startCandidateEmailVerification(store, env, opportunity.job_code!, 'candidate@example.com', true, '127.0.0.1'))
        .rejects.toMatchObject({ code: 'email_delivery_failed' });
      expect(store.candidateApplications).toHaveLength(0);
      expect(store.candidateOtpEvents).toHaveLength(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it('does not store consented email without an OTP request or valid code', async () => {
    const { store, opportunity } = await publishedOpportunity();
    const env = resolveEnv({ CANDIDATE_EMAIL_OTP_SECRET: 'test-only-secret-with-enough-entropy' });
    await expect(completeCandidateEmailVerification(store, env, opportunity.job_code!, 'candidate@example.com', '123456'))
      .rejects.toMatchObject({ code: 'verification_failed' });
    expect(store.candidateApplications).toHaveLength(0);
  });

  it('does not store the email when consent is absent or the listing is closed', async () => {
    const { store, opportunity } = await publishedOpportunity();
    const env = resolveEnv({ RESEND_API_KEY: 'test-api-key', CANDIDATE_EMAIL_FROM: 'jobs@verified.example', CANDIDATE_EMAIL_OTP_SECRET: 'test-only-secret-with-enough-entropy' });
    await expect(startCandidateEmailVerification(store, env, opportunity.job_code!, 'candidate@example.com', false, '127.0.0.1'))
      .rejects.toMatchObject({ code: 'consent_required' });
    await store.updateOpportunity(opportunity.id, { status: 'closed', closed_at: new Date().toISOString() });
    await expect(startCandidateEmailVerification(store, env, opportunity.job_code!, 'candidate@example.com', true, '127.0.0.1'))
      .rejects.toMatchObject({ code: 'job_unavailable' });
    expect(store.candidateApplications).toHaveLength(0);
  });

  it('resend requests are limited by normalized email', async () => {
    const { store, opportunity } = await publishedOpportunity();
    const env = resolveEnv({ RESEND_API_KEY: 'test-api-key', CANDIDATE_EMAIL_FROM: 'jobs@verified.example', CANDIDATE_EMAIL_OTP_SECRET: 'test-only-secret-with-enough-entropy' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    try {
      for (let i = 0; i < 5; i++) await startCandidateEmailVerification(store, env, opportunity.job_code!, 'candidate@example.com', true, '127.0.0.1');
      await expect(startCandidateEmailVerification(store, env, opportunity.job_code!, ' CANDIDATE@example.com ', true, '127.0.0.1'))
        .rejects.toMatchObject({ code: 'otp_rate_limited' });
    } finally { vi.unstubAllGlobals(); }
  });
});
