import { describe, expect, it } from 'vitest';
import type { AIProvider } from '../../src/lib/ai/provider';
import { createRetrievalService } from '../../src/lib/linkedin/jsonld';
import { retrievalFailure, type RetrievalFn, type RetrievedPost } from '../../src/lib/linkedin/types';
import { ingestLinkedInUrl, RETRIEVAL_MAX_ATTEMPTS } from '../../src/lib/services/ingest-source';
import { processCapture, submitCapture } from '../../src/lib/services/capture';
import { handleTelegramUpdate } from '../../src/lib/telegram/service';
import { fakeAI, RecordingMessenger, SAMPLE_TEXT, seedStore, SITE_URL, testEnv } from '../helpers';

const POST_URL = 'https://www.linkedin.com/posts/acme_founder-associate-1234567890';
const CANONICAL = 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890';

function retrievedPost(overrides: Partial<RetrievedPost> = {}): RetrievedPost {
  const text = overrides.text ?? `Post author: Acme Founder\n\n${SAMPLE_TEXT}`;
  return {
    canonicalUrl: CANONICAL,
    activityId: '1234567890',
    author: 'Acme Founder',
    postedAt: '2026-02-01T09:30:00.000Z',
    headline: 'Acme Labs is hiring',
    articleBody: SAMPLE_TEXT,
    sharedContent: null,
    comments: [],
    text,
    metadata: { parser_version: 'linkedin-jsonld-1', comment_count: 0 },
    ...overrides,
  };
}

function successRetrieval(overrides: Partial<RetrievedPost> = {}): RetrievalFn {
  return async () => ({ ok: true, method: 'jsonld', httpStatus: 200, post: retrievedPost(overrides) });
}

function failingRetrieval(code: Parameters<typeof retrievalFailure>[0], retryable = false): RetrievalFn {
  return async () => retrievalFailure(code, `Simulated ${code}.`, { method: 'jsonld', retryable });
}

function messageUpdate(updateId: number, text: string, userId = 111) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: userId, first_name: 'Owner' },
      chat: { id: 999, type: 'private' },
      text,
    },
  };
}

describe('URL-first LinkedIn ingestion', () => {
  it('persists the URL, retrieves content, keeps provenance and creates an opening', async () => {
    const { store } = await seedStore();
    const ai = fakeAI();

    const outcome = await ingestLinkedInUrl(
      store,
      ai,
      { sourceUrl: POST_URL, actor: 'telegram:111', telegramUserId: 111 },
      successRetrieval({
        comments: [{ author: 'Acme Founder', text: 'Apply: https://acme.test/apply/fa', links: ['https://acme.test/apply/fa'], is_author: true }],
      }),
      { siteUrl: SITE_URL },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const capture = outcome.capture;
    expect(capture.source_url).toBe(POST_URL);
    expect(capture.retrieval_status).toBe('retrieved');
    expect(capture.retrieval_method).toBe('jsonld');
    expect(capture.retrieval_http_status).toBe(200);
    expect(capture.retrieval_attempts).toBe(1);
    expect(capture.retrieved_at).not.toBeNull();
    expect(capture.source_author).toBe('Acme Founder');
    expect(capture.source_posted_at).toBe('2026-02-01T09:30:00.000Z');
    expect(capture.source_comments).toHaveLength(1);
    expect(capture.raw_text).toContain('Acme Labs is hiring a Founding Full Stack Engineer.');
    expect(capture.status).toBe('needs_review');

    expect(outcome.result.opportunities).toHaveLength(1);
    const opp = outcome.result.opportunities[0];
    expect(opp.source_capture_id).toBe(capture.id);
    expect(opp.source_url).toBe(POST_URL);
    expect(opp.canonical_source_key).toBe('linkedin:1234567890');
    expect(opp.opening_key).toBe(1);

    // Retrieved provenance is passed to the AI request.
    expect(ai.calls[0].sourceMeta?.author).toBe('Acme Founder');
    expect(ai.calls[0].sourceMeta?.comments).toHaveLength(1);
  });

  it('keeps the URL and records the exact failure when retrieval fails', async () => {
    const { store } = await seedStore();

    const outcome = await ingestLinkedInUrl(
      store,
      fakeAI(),
      { sourceUrl: POST_URL, actor: 'telegram:111', telegramUserId: 111 },
      failingRetrieval('login_required'),
      { siteUrl: SITE_URL },
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errorCode).toBe('login_required');
    expect(outcome.capture?.status).toBe('retrieval_failed');
    expect(outcome.capture?.retrieval_status).toBe('failed');
    expect(outcome.capture?.retrieval_error_code).toBe('login_required');
    expect(outcome.capture?.source_url).toBe(POST_URL);
    expect(outcome.capture?.raw_text).toBe('');
    // Access blocks are not retried automatically.
    expect(outcome.capture?.next_retry_at).toBeNull();
    expect(store.opportunities).toHaveLength(0);
    expect(store.captures).toHaveLength(1);
  });

  it('schedules transient failures for automatic retry with backoff', async () => {
    const { store } = await seedStore();
    const outcome = await ingestLinkedInUrl(
      store,
      fakeAI(),
      { sourceUrl: POST_URL, actor: 'telegram:111' },
      failingRetrieval('timeout', true),
      { siteUrl: SITE_URL },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.capture?.status).toBe('retrieval_failed');
    expect(outcome.capture?.next_retry_at).not.toBeNull();
    expect(Date.parse(outcome.capture!.next_retry_at!)).toBeGreaterThan(Date.now());
  });

  it('moves to manual-source mode when retrieval is not authorised, keeping the URL', async () => {
    const { store } = await seedStore();
    const outcome = await ingestLinkedInUrl(
      store,
      fakeAI(),
      { sourceUrl: POST_URL, actor: 'telegram:111', telegramUserId: 111 },
      createRetrievalService(testEnv()),
      { siteUrl: SITE_URL },
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errorCode).toBe('retrieval_not_authorised');
    expect(outcome.capture?.status).toBe('awaiting_text');
    expect(outcome.capture?.retrieval_status).toBe('skipped');
    expect(outcome.capture?.source_url).toBe(POST_URL);
    expect(outcome.capture?.next_retry_at).toBeNull();
  });

  it('rejects non-LinkedIn URLs without creating a capture', async () => {
    const { store } = await seedStore();
    const outcome = await ingestLinkedInUrl(
      store,
      fakeAI(),
      { sourceUrl: 'https://example.com/jobs/123', actor: 'telegram:111' },
      successRetrieval(),
      { siteUrl: SITE_URL },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errorCode).toBe('invalid_url');
    expect(store.captures).toHaveLength(0);
  });

  it('reuses a failed capture instead of creating a duplicate, and extracts after retrieval succeeds', async () => {
    const { store } = await seedStore();
    const failed = await ingestLinkedInUrl(
      store,
      fakeAI(),
      { sourceUrl: POST_URL, actor: 'telegram:111' },
      failingRetrieval('login_required'),
      { siteUrl: SITE_URL },
    );
    expect(failed.ok).toBe(false);

    const retried = await ingestLinkedInUrl(
      store,
      fakeAI(),
      { sourceUrl: POST_URL, actor: 'telegram:111' },
      successRetrieval(),
      { siteUrl: SITE_URL },
    );

    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(store.captures).toHaveLength(1);
    expect(retried.capture.id).toBe(failed.capture?.id);
    expect(retried.capture.retrieval_status).toBe('retrieved');
    expect(retried.result.opportunities).toHaveLength(1);
  });

  it('blocks a duplicate submission after a successful capture', async () => {
    const { store } = await seedStore();
    const first = await ingestLinkedInUrl(
      store,
      fakeAI(),
      { sourceUrl: POST_URL, actor: 'telegram:111' },
      successRetrieval(),
      { siteUrl: SITE_URL },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await ingestLinkedInUrl(
      store,
      fakeAI(),
      { sourceUrl: `${POST_URL}?utm_source=share`, actor: 'telegram:111' },
      successRetrieval(),
      { siteUrl: SITE_URL },
    );

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.errorCode).toBe('duplicate');
    expect(second.duplicate?.captureId).toBe(first.capture.id);
    expect(store.opportunities).toHaveLength(1);
  });
});

describe('retrieval retry queue', () => {
  it('claims only due captures, increments attempts, and never claims the same row twice', async () => {
    const { store } = await seedStore();
    const failed = await ingestLinkedInUrl(
      store,
      fakeAI(),
      { sourceUrl: POST_URL, actor: 'telegram:111' },
      failingRetrieval('timeout', true),
      { siteUrl: SITE_URL },
    );
    expect(failed.ok).toBe(false);
    if (failed.ok || !failed.capture) return;

    // Not yet due.
    expect(await store.claimDueRetrievals(5)).toHaveLength(0);

    await store.updateCapture(failed.capture.id, {
      next_retry_at: new Date(Date.now() - 1000).toISOString(),
    });

    const claimed = await store.claimDueRetrievals(5);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(failed.capture.id);
    expect(claimed[0].status).toBe('retrieving');
    expect(claimed[0].retrieval_attempts).toBe((failed.capture?.retrieval_attempts ?? 0) + 1);

    // Already claimed, so a second worker gets nothing.
    expect(await store.claimDueRetrievals(5)).toHaveLength(0);
  });

  it('stops claiming after the maximum number of attempts', async () => {
    const { store } = await seedStore();
    const failed = await ingestLinkedInUrl(
      store,
      fakeAI(),
      { sourceUrl: POST_URL, actor: 'telegram:111' },
      failingRetrieval('timeout', true),
      { siteUrl: SITE_URL },
    );
    expect(failed.ok).toBe(false);
    if (failed.ok || !failed.capture) return;

    await store.updateCapture(failed.capture.id, {
      retrieval_attempts: RETRIEVAL_MAX_ATTEMPTS,
      status: 'retrieval_failed',
      next_retry_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await store.claimDueRetrievals(5)).toHaveLength(0);
  });

  it('recovers captures stuck in retrieving after a worker restart', async () => {
    const { store } = await seedStore();
    const failed = await ingestLinkedInUrl(
      store,
      fakeAI(),
      { sourceUrl: POST_URL, actor: 'telegram:111' },
      failingRetrieval('timeout', true),
      { siteUrl: SITE_URL },
    );
    expect(failed.ok).toBe(false);
    if (failed.ok || !failed.capture) return;

    await store.updateCapture(failed.capture.id, {
      status: 'retrieving',
      processing_started_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    });

    expect(await store.recoverStaleRetrieving(120)).toBe(1);
    const recovered = await store.getCapture(failed.capture.id);
    expect(recovered?.status).toBe('retrieval_failed');
    expect(recovered?.retrieval_error_code).toBe('stale_recovered');
    expect(recovered?.next_retry_at).not.toBeNull();
  });

  it('recovers an extraction left running after a worker crash without losing the source', async () => {
    const { store } = await seedStore();
    const submitted = await submitCapture(store, {
      sourceUrl: POST_URL,
      rawText: SAMPLE_TEXT,
      sourceType: 'linkedin_post',
      actor: 'telegram:111',
    });

    await store.updateCapture(submitted.capture.id, {
      status: 'extracting',
      processing_started_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    });

    // A second capture that is still legitimately running is left alone.
    const active = await submitCapture(store, {
      sourceUrl: 'https://www.linkedin.com/posts/acme_growth-9876543210',
      rawText: SAMPLE_TEXT,
      sourceType: 'linkedin_post',
      actor: 'telegram:111',
    });
    await store.updateCapture(active.capture.id, {
      status: 'extracting',
      processing_started_at: new Date().toISOString(),
    });

    expect(await store.recoverStaleExtracting(30 * 60)).toBe(1);

    const recovered = await store.getCapture(submitted.capture.id);
    expect(recovered?.status).toBe('extraction_failed');
    expect(recovered?.raw_text).toBe(SAMPLE_TEXT);
    expect(recovered?.error_message).toContain('worker restart');

    const untouched = await store.getCapture(active.capture.id);
    expect(untouched?.status).toBe('extracting');
  });
});

describe('Telegram URL-first flow and manual fallback', () => {
  const suppliedTelegramUrls = [
    'https://www.linkedin.com/posts/krishi-prasad_were-hiring-at-sure-role-founders-office-share-7526946904958668801-Aogk',
    'https://www.linkedin.com/posts/shivani-shenoy-2605a7261_hiring-executiveassistant-ceosoffice-share-7526946885132234752-sF6p',
  ];

  it.each(suppliedTelegramUrls.flatMap((url) => [url, `${url}?utm_source=linkedin&utm_medium=member_desktop&rcm=ACoAAA&utm_campaign=share`]))(
    'accepts a shared LinkedIn post and preserves its original URL: %s',
    async (sourceUrl) => {
      const { store } = await seedStore();
      const ai = fakeAI();
      const messenger = new RecordingMessenger();
      const retrievalUrl = sourceUrl.split('?')[0].replace(/\/posts\/[^/]+$/, (path) => {
        const id = path.match(/(\d{10,})-[A-Za-z0-9]{4}$/)?.[1];
        return `/feed/update/urn:li:activity:${id}`;
      });
      const retrieval = async (url: string) => {
        // The URL is durably captured before retrieval is attempted.
        expect(store.captures).toHaveLength(1);
        expect(url).toBe(retrievalUrl);
        return retrievalFailure('retrieval_not_authorised', 'Automatic retrieval is not authorised.', {
          method: 'jsonld',
          retryable: false,
        });
      };

      await handleTelegramUpdate(messageUpdate(1, sourceUrl), {
        store,
        ai,
        env: testEnv(),
        messenger,
        retrieval,
      });

      expect(store.captures).toHaveLength(1);
      expect(store.captures[0].source_url).toBe(sourceUrl);
      expect(store.captures[0].normalized_source_key).toMatch(/^linkedin:\d{10,}$/);
      expect(store.captures[0].status).toBe('awaiting_text');
      expect(ai.calls).toHaveLength(0);
      expect(messenger.sent.some((entry) => /send the copied post text/i.test(entry.text))).toBe(true);
    },
  );

  it('rejects a LinkedIn posts path without a numeric activity id', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();

    await handleTelegramUpdate(messageUpdate(1, 'https://www.linkedin.com/posts/acme_hiring-team-Aogk'), {
      store,
      ai: fakeAI(),
      env: testEnv(),
      messenger,
      retrieval: successRetrieval(),
    });

    expect(store.captures).toHaveLength(0);
    expect(messenger.sent.some((entry) => entry.text.includes('Only links to specific LinkedIn posts'))).toBe(true);
  });

  it('acknowledges a URL, retrieves it and sends opening previews', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();

    await handleTelegramUpdate(messageUpdate(1, POST_URL), {
      store,
      ai: fakeAI(),
      env: testEnv(),
      messenger,
      retrieval: successRetrieval(),
    });

    expect(messenger.sent[0].text).toContain('Saving it and retrieving');
    expect(messenger.sent.some((m) => m.text.includes('Opportunity preview'))).toBe(true);
    expect(store.opportunities).toHaveLength(1);
    expect(store.captures[0].source_url).toBe(POST_URL);
  });

  it('asks for copied text after a failed retrieval and then extracts from the same capture', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();
    const deps = { store, ai: fakeAI(), env: testEnv(), messenger };

    await handleTelegramUpdate(messageUpdate(1, POST_URL), {
      ...deps,
      retrieval: failingRetrieval('login_required'),
    });

    const failureMessage = messenger.sent.find((m) => m.text.includes('⚠️'));
    expect(failureMessage).toBeTruthy();
    expect(failureMessage?.text).toContain('Send the copied post text');
    expect(store.captures[0].status).toBe('retrieval_failed');
    expect(store.captures[0].source_url).toBe(POST_URL);
    expect(store.opportunities).toHaveLength(0);

    await handleTelegramUpdate(messageUpdate(2, SAMPLE_TEXT), deps);

    expect(store.captures).toHaveLength(1);
    expect(store.captures[0].raw_text).toBe(SAMPLE_TEXT);
    expect(store.captures[0].retrieval_method).toBe('manual_text');
    expect(store.captures[0].status).toBe('needs_review');
    expect(store.opportunities).toHaveLength(1);
    expect(store.opportunities[0].source_url).toBe(POST_URL);
    expect(messenger.sent.some((m) => m.text.includes('Opportunity preview'))).toBe(true);
  });

  it('does not attach copied text to a different pending post', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();
    const deps = { store, ai: fakeAI(), env: testEnv(), messenger };

    await handleTelegramUpdate(messageUpdate(1, POST_URL), {
      ...deps,
      retrieval: failingRetrieval('login_required'),
    });
    expect(store.captures).toHaveLength(1);
    const firstId = store.captures[0].id;

    const otherUrl = 'https://www.linkedin.com/posts/acme_growth-manager-9876543210';
    await handleTelegramUpdate(messageUpdate(2, `${otherUrl}\n${SAMPLE_TEXT}`), deps);

    expect(store.captures).toHaveLength(2);
    const first = await store.getCapture(firstId);
    expect(first?.raw_text).toBe('');
    expect(first?.status).toBe('retrieval_failed');

    const second = store.captures.find((c) => c.id !== firstId);
    expect(second?.raw_text).toBe(SAMPLE_TEXT);
    expect(second?.normalized_source_key).toBe('linkedin:9876543210');
    expect(second?.status).toBe('needs_review');
    expect(store.opportunities).toHaveLength(1);
  });

  it('tells the admin when a URL was already captured', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();
    const deps = { store, ai: fakeAI(), env: testEnv(), messenger, retrieval: successRetrieval() };

    await handleTelegramUpdate(messageUpdate(1, POST_URL), deps);
    await handleTelegramUpdate(messageUpdate(2, POST_URL), deps);

    expect(messenger.sent.some((m) => m.text.includes('already been captured'))).toBe(true);
    expect(store.opportunities).toHaveLength(1);
  });

  it('rejects non-LinkedIn URLs without creating a capture', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();

    await handleTelegramUpdate(messageUpdate(1, 'https://example.com/job/123'), {
      store,
      ai: fakeAI(),
      env: testEnv(),
      messenger,
      retrieval: successRetrieval(),
    });

    expect(messenger.sent.at(-1)?.text).toContain('Only links to specific LinkedIn posts');
    expect(store.captures).toHaveLength(0);
  });
});

describe('coverage verification for long posts', () => {
  function partialAI(): AIProvider {
    return {
      name: 'partial-ai',
      async extract(): Promise<unknown> {
        return {
          is_genuine_opportunity: true,
          genuine_opportunity_reason: null,
          company_name: 'Acme Labs',
          confidence: 0.9,
          warnings: [],
          openings: [1, 2, 3, 4].map((n) => ({
            job_title: `Role ${n}`,
            company_name: 'Acme Labs',
            category_slug: 'engineering',
            summary: `Description for role ${n}.`,
            application_url: `https://acme.test/apply/role-${n}`,
            application_method: 'external_url',
          })),
        };
      },
      async listRoles(): Promise<string[]> {
        return ['Role 1', 'Role 2', 'Role 3', 'Role 4', 'Role 5'];
      },
    };
  }

  it('flags an unextracted role without discarding the extracted openings', async () => {
    const { store } = await seedStore();
    const submitted = await submitCapture(store, {
      sourceUrl: POST_URL,
      rawText: SAMPLE_TEXT,
      sourceType: 'linkedin_post',
      actor: 'telegram:111',
    });

    const result = await processCapture(store, partialAI(), submitted.capture.id, {
      actor: 'telegram:111',
      siteUrl: SITE_URL,
    });

    expect(result.opportunities).toHaveLength(4);
    expect(result.warnings.some((w) => w.includes('Coverage check'))).toBe(true);

    const stored = await store.getCapture(submitted.capture.id);
    const coverage = (stored?.extraction as { coverage_check?: { missing: string[] } } | null)?.coverage_check;
    expect(coverage?.missing).toEqual(['Role 5']);
  });

  it('does not discard extraction when the coverage call fails', async () => {
    const { store } = await seedStore();
    const submitted = await submitCapture(store, {
      sourceUrl: POST_URL,
      rawText: SAMPLE_TEXT,
      sourceType: 'linkedin_post',
      actor: 'telegram:111',
    });

    const ai = partialAI();
    const failingCoverage: AIProvider = {
      ...ai,
      async listRoles(): Promise<string[]> {
        throw new Error('Groq quota exceeded');
      },
    };

    const result = await processCapture(store, failingCoverage, submitted.capture.id, {
      actor: 'telegram:111',
      siteUrl: SITE_URL,
    });
    expect(result.opportunities).toHaveLength(4);
    expect(result.capture.status).toBe('needs_review');
  });
});
