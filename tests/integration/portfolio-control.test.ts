import { describe, expect, it } from 'vitest';
import { handlePortfolioBotUpdate } from '../../src/lib/portfolio/control-bot';
import { deliverNextLinkedInBatch, acknowledgeAndContinue, dispatchPortfolioDelivery } from '../../src/lib/portfolio/linkedin-delivery';
import { publishOpportunity } from '../../src/lib/services/publishing';
import { MemoryStore } from '../../src/lib/store/memory-store';
import { RecordingMessenger, SAMPLE_TEXT, fakeAI, seedStore, testEnv } from '../helpers';
import { processCapture, submitCapture } from '../../src/lib/services/capture';
import type { TelegramUpdate } from '../../src/lib/telegram/service';

function responseJson(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('portfolio control bot', () => {
  it('verifies /start and runs one complete initial recent-jobs scan manually', async () => {
    const store = new MemoryStore();
    const messenger = new RecordingMessenger();
    const env = testEnv({
      portfolioTelegramBotToken: 'test-portfolio-token',
      portfolioTelegramChatId: '-10012345',
      portfolioTelegramWebhookSecret: 'portfolio-secret',
      telegramAdminIds: [111],
    });
    await store.createCategory({ name: 'Other Startup Roles', slug: 'other-startup-roles', description: 'Startup roles without a narrower category.', is_active: true, is_featured: false, sort_order: 100 });
    const company = await store.createCompany({ name: 'Northstar', slug: 'northstar', website: 'https://northstar.example', careers_url: 'https://northstar.example/careers', verified: true });
    await store.upsertCompanySource({ company_id: company.id, provider: 'greenhouse', board_identifier: 'northstar', source_url: 'https://boards.greenhouse.io/northstar', sync_status: 'idle' });
    const stagedSource = await store.upsertCompanySource({ company_id: company.id, provider: 'greenhouse', board_identifier: 'staged', source_url: 'https://boards.greenhouse.io/staged', sync_status: 'idle' });
    stagedSource.is_active = false;
    const firstPublished = new Date(Date.now() - 86_400_000).toISOString();
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('jumpcap-jobs-public/jobs.json')) {
        return responseJson({
          jobs: [{ id: 'jump-1', company: 'Bright Demo', title: 'Software Engineer', location: 'Remote, India', apply_url: 'https://jobs.brightdemo.example/apply/1', first_seen: new Date().toISOString() }],
          companies: [{ company: 'Bright Demo', website: 'https://brightdemo.example', careers_url: 'https://brightdemo.example/careers' }],
        });
      }
      if (url === 'https://jobb.a-hub.se/jobs.rss') {
        const xml = '<rss><channel><item><title>Product Designer</title><link>https://jobs.northstar.example/apply/2</link><guid>ahub-2</guid><pubDate>' + new Date().toUTCString() + '</pubDate><description><![CDATA[Northstar is hiring a product designer to build its scheduling product.]]></description><tt:name>Stockholm</tt:name></item></channel></rss>';
        return new Response(xml, { status: 200 });
      }
      if (url.startsWith('https://boards-api.greenhouse.io/v1/boards/northstar/jobs')) {
        return responseJson({ jobs: [{ id: 101, title: 'Senior Data Engineer', absolute_url: 'https://boards.greenhouse.io/northstar/jobs/101', content: '<p>Build and maintain reliable data pipelines for the company analytics platform. Partner with product and engineering teams to improve data quality, documentation, and reporting for customers.</p>', location: { name: 'Remote, US' }, first_published: firstPublished, updated_at: new Date().toISOString() }] });
      }
      if (url.includes('/boards/staged/')) throw new Error('Inactive company source should not be queried.');
      throw new Error('Unexpected source URL: ' + url);
    };
    const start: TelegramUpdate = {
      update_id: 1001,
      message: { message_id: 1, from: { id: 111 }, chat: { id: -10012345, type: 'group' }, text: '/start' },
    };
    await handlePortfolioBotUpdate(start, { env, store, messenger, fetcher });
    expect(await store.getPortfolioAdminChat(111)).toBe(-10012345);

    const fetchCommand: TelegramUpdate = {
      update_id: 1002,
      message: { message_id: 2, from: { id: 111 }, chat: { id: -10012345, type: 'group' }, text: '/fetch' },
    };
    await handlePortfolioBotUpdate(fetchCommand, { env, store, messenger, fetcher });

    await handlePortfolioBotUpdate({
      update_id: 1003,
      message: { message_id: 3, from: { id: 111 }, chat: { id: -10012345, type: 'group' }, text: '/status' },
    }, { env, store, messenger });

    const run = await store.latestPortfolioSearch();
    expect(run?.status).toBe('completed');
    expect(run?.full_backfill).toBe(false);
    expect(run?.report).toMatchObject({ scanned: 3, created: 3 });
    expect((await store.listAdmin({ status: 'pending_review', page: 1, pageSize: 10 })).total).toBe(1);
    expect((await store.listAdmin({ status: 'draft', page: 1, pageSize: 10 })).total).toBe(2);
    expect(store.opportunities.find((job) => job.title === 'Software Engineer')?.quality_flags).toContain('needs_information');
    expect(store.opportunities.find((job) => job.title === 'Senior Data Engineer')?.original_posted_at).toBe(firstPublished.slice(0, 10));
    expect(messenger.sent.some((message) => message.text.includes('last successful source checkpoints'))).toBe(true);
    expect(messenger.sent.at(-1)?.text).toContain('Latest search: completed');
    expect(messenger.sent.at(-1)?.text).toContain('Pending admin review: 1');
  });

  it('queues a factual draft on publication and sends/acknowledges one batch once', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();
    const env = testEnv({ portfolioTelegramChatId: '-10012345' });
    const submitted = await submitCapture(store, {
      sourceUrl: 'https://www.linkedin.com/posts/acme_founder-engineer-1234567890',
      rawText: SAMPLE_TEXT,
      sourceType: 'linkedin_post',
      actor: 'admin:test@example.com',
    });
    const processed = await processCapture(store, fakeAI(), submitted.capture.id, { actor: 'admin:test@example.com', siteUrl: env.siteUrl });
    const opportunity = processed.opportunities[0]!;
    await publishOpportunity(store, opportunity.id, 'admin:test@example.com', env.siteUrl);

    const delivered = await deliverNextLinkedInBatch(env, store, messenger);
    expect(delivered.sent).toBe(1);
    const postMessage = messenger.sent[0].text;
    expect(postMessage).toContain('Founding Full Stack Engineer');
    expect(postMessage).toContain('/opportunities/HC-');
    expect(postMessage).toContain('Apply Now button');
    expect(messenger.sent.at(-1)?.options?.reply_markup?.inline_keyboard[0][0]).toMatchObject({ text: 'DONE — SEND NEXT 30' });

    await acknowledgeAndContinue(env, store, messenger, delivered.batchNumber!);
    const counts = await store.linkedinDeliveryCounts();
    expect(counts.acknowledged).toBe(1);
    expect(counts.queued).toBe(0);

    const before = messenger.sent.length;
    await acknowledgeAndContinue(env, store, messenger, delivered.batchNumber!);
    expect(messenger.sent.length).toBe(before + 1);
    expect(messenger.sent.at(-1)?.text).toContain('already acknowledged');
  });

  it('keeps published drafts queued until an allowlisted admin verifies the configured chat', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();
    const env = testEnv({
      portfolioTelegramBotToken: 'test-portfolio-token',
      portfolioTelegramChatId: '-10012345',
      portfolioTelegramWebhookSecret: 'portfolio-secret',
      telegramAdminIds: [111],
    });
    const submitted = await submitCapture(store, {
      sourceUrl: 'https://www.linkedin.com/posts/acme_founder-engineer-1234567890',
      rawText: SAMPLE_TEXT,
      sourceType: 'linkedin_post',
      actor: 'admin:test@example.com',
    });
    const processed = await processCapture(store, fakeAI(), submitted.capture.id, { actor: 'admin:test@example.com', siteUrl: env.siteUrl });
    await publishOpportunity(store, processed.opportunities[0]!.id, 'admin:test@example.com', env.siteUrl);

    const delivery = await dispatchPortfolioDelivery(env, store);
    expect(delivery.sent).toBe(0);
    expect(messenger.sent).toHaveLength(0);
    expect((await store.linkedinDeliveryCounts()).queued).toBe(1);
  });

  it('does not hand the same in-flight batch to a concurrent delivery worker', async () => {
    const { store } = await seedStore();
    const submitted = await submitCapture(store, {
      sourceUrl: 'https://www.linkedin.com/posts/acme_founder-engineer-1234567890',
      rawText: SAMPLE_TEXT,
      sourceType: 'linkedin_post',
      actor: 'admin:test@example.com',
    });
    const processed = await processCapture(store, fakeAI(), submitted.capture.id, { actor: 'admin:test@example.com', siteUrl: testEnv().siteUrl });
    await publishOpportunity(store, processed.opportunities[0]!.id, 'admin:test@example.com', testEnv().siteUrl);

    const [first, concurrent] = await Promise.all([
      store.claimNextLinkedInDeliveryBatch(30),
      store.claimNextLinkedInDeliveryBatch(30),
    ]);
    expect(first).toHaveLength(1);
    expect(concurrent).toHaveLength(0);
  });

  it('does not authorize a user who is outside the shared Telegram allowlist', async () => {
    const store = new MemoryStore();
    const messenger = new RecordingMessenger();
    const env = testEnv({ portfolioTelegramChatId: '-10012345', telegramAdminIds: [111] });
    const update: TelegramUpdate = {
      update_id: 2001,
      message: { message_id: 1, from: { id: 222 }, chat: { id: -10012345, type: 'group' }, text: '/start' },
    };
    await handlePortfolioBotUpdate(update, { env, store, messenger });
    expect(await store.getPortfolioAdminChat(222)).toBeNull();
    expect(messenger.sent[0].text).toContain('allowlisted admin accounts');
  });

  it('uses an isolated portfolio allowlist without changing LinkedIn intake admins', async () => {
    const store = new MemoryStore();
    const messenger = new RecordingMessenger();
    const env = testEnv({ telegramAdminIds: [111], portfolioTelegramAdminIds: [222], portfolioTelegramChatId: '-10012345' });
    await handlePortfolioBotUpdate({
      update_id: 1010,
      message: { message_id: 10, from: { id: 222 }, chat: { id: -10012345, type: 'group' }, text: '/start' },
    }, { env, store, messenger });
    expect(await store.getPortfolioAdminChat(222)).toBe(-10012345);
    expect(messenger.sent.at(-1)?.text).toContain('Portfolio control bot is ready');
    expect(env.telegramAdminIds).toEqual([111]);
  });

  it('sends 30 posts, waits for DONE, then sends the remaining post without duplicates', async () => {
    const { store } = await seedStore();
    const env = testEnv({ portfolioTelegramChatId: '-10012345', telegramAdminIds: [111] });
    await store.setPortfolioAdminChat(111, -10012345);
    const submitted = await submitCapture(store, {
      sourceUrl: 'https://www.linkedin.com/posts/acme_founder-engineer-1234567890',
      rawText: SAMPLE_TEXT,
      sourceType: 'linkedin_post',
      actor: 'admin:test@example.com',
    });
    const processed = await processCapture(store, fakeAI(), submitted.capture.id, { actor: 'admin:test@example.com', siteUrl: env.siteUrl });
    const original = processed.opportunities[0]!;
    for (let index = 2; index <= 31; index += 1) {
      const { id: sourceId, job_code: sourceJobCode, created_at: sourceCreatedAt, updated_at: sourceUpdatedAt, ...copy } = original;
      void sourceId; void sourceJobCode; void sourceCreatedAt; void sourceUpdatedAt;
      await store.createOpportunity({
        ...copy,
        id: undefined,
        job_code: undefined,
        slug: `portfolio-test-role-${index}`,
        title: `Portfolio Test Role ${index}`,
        canonical_source_key: `portfolio-test:${index}`,
        source_capture_id: null,
        linkedin_post_draft: null,
        status: 'pending_review',
        published_at: null,
        closed_at: null,
      });
    }
    for (const opportunity of store.opportunities) await publishOpportunity(store, opportunity.id, 'admin:test@example.com', env.siteUrl);

    const messenger = new RecordingMessenger();
    const first = await deliverNextLinkedInBatch(env, store, messenger, -10012345, 0);
    expect(first.sent).toBe(30);
    await expect(store.linkedinDeliveryCounts().then((counts) => counts.sent)).resolves.toBe(30);

    await handlePortfolioBotUpdate({ update_id: 3001, message: { message_id: 3001, from: { id: 111 }, chat: { id: -10012345, type: 'group' }, text: '/done' } }, { env, store, messenger });
    expect(messenger.sent.filter((item) => item.text.startsWith('📌 '))).toHaveLength(31);
    const secondBatch = await store.currentLinkedInDeliveryBatch();
    expect(secondBatch).toBeGreaterThan(first.batchNumber!);
    await handlePortfolioBotUpdate({ update_id: 3002, message: { message_id: 3002, from: { id: 111 }, chat: { id: -10012345, type: 'group' }, text: '/done' } }, { env, store, messenger });
    const postsAfterEmpty = messenger.sent.filter((item) => item.text.startsWith('📌 ')).length;
    await handlePortfolioBotUpdate({ update_id: 3003, message: { message_id: 3003, from: { id: 111 }, chat: { id: -10012345, type: 'group' }, text: '/done' } }, { env, store, messenger });
    expect(messenger.sent.filter((item) => item.text.startsWith('📌 '))).toHaveLength(postsAfterEmpty);
    expect(messenger.sent.at(-1)?.text).toContain('queue is empty');
  });
});
