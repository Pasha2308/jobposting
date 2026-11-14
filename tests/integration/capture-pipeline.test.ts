import { describe, expect, it } from 'vitest';
import { processCapture, retryCapture, submitCapture } from '../../src/lib/services/capture';
import { ServiceError } from '../../src/lib/services/errors';
import { fakeAI, failingAI, SAMPLE_TEXT, seedStore, SITE_URL } from '../helpers';

const SOURCE_URL = 'https://www.linkedin.com/posts/acme_founder-engineer-1234567890';

describe('capture pipeline', () => {
  it('preserves the source, extracts a draft and generates comments', async () => {
    const { store } = await seedStore();
    const ai = fakeAI();

    const submitted = await submitCapture(store, {
      sourceUrl: SOURCE_URL,
      rawText: SAMPLE_TEXT,
      sourceType: 'linkedin_post',
      actor: 'admin:test@example.com',
    });
    expect(submitted.capture.raw_text).toBe(SAMPLE_TEXT);
    expect(submitted.sourceKey).toBe('linkedin:1234567890');

    const result = await processCapture(store, ai, submitted.capture.id, {
      actor: 'admin:test@example.com',
      siteUrl: SITE_URL,
    });

    expect(result.genuine).toBe(true);
    expect(result.opportunity).not.toBeNull();
    expect(result.opportunity?.status).toBe('pending_review');
    expect(result.opportunity?.company?.name).toBe('Acme Labs');
    expect(result.opportunity?.category?.slug).toBe('engineering');
    expect(result.opportunity?.source_capture_id).toBe(submitted.capture.id);
    expect(result.opportunity?.published_at).toBeNull();

    expect(result.capture.status).toBe('needs_review');
    expect(result.capture.opportunity_id).toBe(result.opportunity?.id);
    expect(result.capture.attempt_count).toBe(1);

    const comments = await store.listComments(result.opportunity!.id);
    expect(comments).toHaveLength(3);
    expect(comments.every((comment) => comment.body.length > 0)).toBe(true);
    expect(comments.every((comment) => !comment.includes_listing_url)).toBe(true);
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0].sourceText).toContain('Founding Full Stack Engineer');
  });

  it('blocks an exact duplicate source before creating a second capture', async () => {
    const { store } = await seedStore();
    await submitCapture(store, {
      sourceUrl: SOURCE_URL,
      rawText: SAMPLE_TEXT,
      sourceType: 'linkedin_post',
      actor: 'admin:test@example.com',
    });

    await expect(
      submitCapture(store, {
        sourceUrl: 'https://m.linkedin.com/posts/acme_founder-engineer-1234567890?utm_source=share',
        rawText: `${SAMPLE_TEXT}\nDuplicate paste.`,
        sourceType: 'linkedin_post',
        actor: 'admin:test@example.com',
      }),
    ).rejects.toMatchObject({ code: 'duplicate', status: 409 });

    expect(store.captures).toHaveLength(1);
  });

  it('keeps the capture on failure and allows a safe retry', async () => {
    const { store } = await seedStore();
    const submitted = await submitCapture(store, {
      sourceUrl: SOURCE_URL,
      rawText: SAMPLE_TEXT,
      sourceType: 'linkedin_post',
      actor: 'admin:test@example.com',
    });

    await expect(
      processCapture(store, failingAI('Gemini quota exhausted.'), submitted.capture.id, {
        actor: 'admin:test@example.com',
        siteUrl: SITE_URL,
      }),
    ).rejects.toThrow(/quota/i);

    const failed = await store.getCapture(submitted.capture.id);
    expect(failed?.status).toBe('extraction_failed');
    expect(failed?.raw_text).toBe(SAMPLE_TEXT);
    expect(failed?.attempt_count).toBe(1);
    expect(failed?.error_message).toMatch(/quota/i);
    expect(await store.listComments('missing')).toHaveLength(0);
    expect(store.opportunities).toHaveLength(0);

    const retried = await retryCapture(store, fakeAI(), submitted.capture.id, {
      actor: 'admin:test@example.com',
      siteUrl: SITE_URL,
    });
    expect(retried.opportunity?.status).toBe('pending_review');
    expect(retried.capture.status).toBe('needs_review');
    expect(retried.capture.attempt_count).toBe(2);
    expect(retried.capture.raw_text).toBe(SAMPLE_TEXT);
  });

  it('does not extract the same capture twice', async () => {
    const { store } = await seedStore();
    const submitted = await submitCapture(store, {
      sourceUrl: SOURCE_URL,
      rawText: SAMPLE_TEXT,
      sourceType: 'linkedin_post',
      actor: 'admin:test@example.com',
    });
    await processCapture(store, fakeAI(), submitted.capture.id, {
      actor: 'admin:test@example.com',
      siteUrl: SITE_URL,
    });

    await expect(
      processCapture(store, fakeAI(), submitted.capture.id, {
        actor: 'admin:test@example.com',
        siteUrl: SITE_URL,
      }),
    ).rejects.toBeInstanceOf(ServiceError);
    expect(store.opportunities).toHaveLength(1);
  });

  it('holds a non-vacancy source for review instead of fabricating a role', async () => {
    const { store } = await seedStore();
    const ai = fakeAI({
      is_genuine_opportunity: false,
      genuine_opportunity_reason: 'The post is a general hiring announcement with no specific role.',
      job_title: null,
    });
    const submitted = await submitCapture(store, {
      sourceUrl: 'https://example.com/blog/hiring',
      rawText: 'We are always looking for great people. Send us a note any time and we will keep you in mind for future roles.',
      sourceType: 'company_website',
      actor: 'admin:test@example.com',
    });

    const result = await processCapture(store, ai, submitted.capture.id, {
      actor: 'admin:test@example.com',
      siteUrl: SITE_URL,
    });
    expect(result.genuine).toBe(false);
    expect(result.opportunity).toBeNull();
    expect(result.capture.status).toBe('needs_review');
    expect(store.opportunities).toHaveLength(0);
  });

  it('rejects invalid captures before storing anything', async () => {
    const { store } = await seedStore();
    await expect(
      submitCapture(store, {
        sourceUrl: 'https://example.com/jobs',
        rawText: 'too short',
        sourceType: 'other',
        actor: 'admin:test@example.com',
      }),
    ).rejects.toMatchObject({ code: 'invalid_capture' });
    expect(store.captures).toHaveLength(0);
  });

  it('clears raw source text only after the retention window', async () => {
    const { store } = await seedStore();
    const submitted = await submitCapture(store, {
      sourceUrl: SOURCE_URL,
      rawText: SAMPLE_TEXT,
      sourceType: 'linkedin_post',
      actor: 'admin:test@example.com',
    });

    expect(await store.purgeExpiredSourceText(180)).toBe(0);
    expect((await store.getCapture(submitted.capture.id))?.raw_text).toBe(SAMPLE_TEXT);

    store.captures[0].created_at = new Date(Date.now() - 200 * 86_400_000).toISOString();
    expect(await store.purgeExpiredSourceText(180)).toBe(1);

    const purged = await store.getCapture(submitted.capture.id);
    expect(purged?.raw_text).toBe('');
    expect(purged?.extraction).toBeNull();
    expect(purged?.source_url).toBe('https://linkedin.com/posts/1234567890');
  });
});
