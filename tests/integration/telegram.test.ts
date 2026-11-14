import { describe, expect, it } from 'vitest';
import { handleTelegramUpdate } from '../../src/lib/telegram/service';
import { fakeAI, RecordingMessenger, SAMPLE_TEXT, seedStore, SITE_URL, testEnv } from '../helpers';

const SOURCE_URL = 'https://www.linkedin.com/posts/acme_founder-engineer-1234567890';

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

function callbackUpdate(updateId: number, data: string, userId: number) {
  return {
    update_id: updateId,
    callback_query: {
      id: `cb-${updateId}`,
      from: { id: userId, first_name: 'Admin' },
      message: {
        message_id: 500,
        chat: { id: 999, type: 'private' },
      },
      data,
    },
  };
}

describe('Telegram capture bot', () => {
  it('rejects users who are not on the allowlist', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();
    await handleTelegramUpdate(messageUpdate(1, 'hello', 999), {
      store,
      ai: fakeAI(),
      env: testEnv(),
      messenger,
    });

    expect(messenger.sent[0].text).toMatch(/not on the allowlist/i);
    expect(store.captures).toHaveLength(0);
  });

  it('captures an allowlisted message, extracts a draft and sends a preview with buttons', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();
    const ai = fakeAI();
    const update = messageUpdate(1, `${SOURCE_URL}\n${SAMPLE_TEXT}`);

    await handleTelegramUpdate(update, { store, ai, env: testEnv(), messenger });

    expect(store.captures).toHaveLength(1);
    expect(store.captures[0].telegram_user_id).toBe(111);
    expect(store.captures[0].raw_text).toBe(SAMPLE_TEXT);
    expect(store.opportunities).toHaveLength(1);
    expect(store.opportunities[0].status).toBe('pending_review');

    const preview = messenger.sent.find((entry) => entry.text.includes('Opportunity preview'));
    expect(preview).toBeTruthy();
    expect(preview?.options?.reply_markup?.inline_keyboard.flat().map((button) => button.text)).toEqual(
      expect.arrayContaining(['Approve & Publish', 'Save Draft', 'Reject', 'Regenerate Comment']),
    );
  });

  it('processes each update id exactly once', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();
    const update = messageUpdate(1, `${SOURCE_URL}\n${SAMPLE_TEXT}`);

    await handleTelegramUpdate(update, { store, ai: fakeAI(), env: testEnv(), messenger });
    const sentAfterFirst = messenger.sent.length;
    await handleTelegramUpdate(update, { store, ai: fakeAI(), env: testEnv(), messenger });

    expect(messenger.sent.length).toBe(sentAfterFirst);
    expect(store.captures).toHaveLength(1);
    expect(store.opportunities).toHaveLength(1);
  });

  it('asks for the copied text when only a URL is sent', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();

    await handleTelegramUpdate(messageUpdate(1, SOURCE_URL), {
      store,
      ai: fakeAI(),
      env: testEnv(),
      messenger,
    });
    expect(store.captures[0].status).toBe('awaiting_text');
    expect(messenger.sent.some((entry) => /send the copied post text/i.test(entry.text))).toBe(true);
    expect(store.opportunities).toHaveLength(0);

    await handleTelegramUpdate(messageUpdate(2, SAMPLE_TEXT), {
      store,
      ai: fakeAI(),
      env: testEnv(),
      messenger,
    });
    expect(store.captures[0].status).toBe('needs_review');
    expect(store.opportunities).toHaveLength(1);
  });

  it('blocks a callback from a different admin and never publishes', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();
    await handleTelegramUpdate(messageUpdate(1, `${SOURCE_URL}\n${SAMPLE_TEXT}`), {
      store,
      ai: fakeAI(),
      env: testEnv(),
      messenger,
    });
    const opportunity = store.opportunities[0];

    await handleTelegramUpdate(callbackUpdate(2, `pub:${opportunity.id}`, 222), {
      store,
      ai: fakeAI(),
      env: testEnv(),
      messenger,
    });

    expect(store.opportunities[0].status).toBe('pending_review');
    expect(messenger.answers.some((answer) => /belongs to another admin/i.test(answer.text ?? ''))).toBe(true);
    expect(messenger.edits).toHaveLength(0);
  });

  it('publishes through the shared service when the owner approves', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();
    await handleTelegramUpdate(messageUpdate(1, `${SOURCE_URL}\n${SAMPLE_TEXT}`), {
      store,
      ai: fakeAI(),
      env: testEnv(),
      messenger,
    });
    const opportunity = store.opportunities[0];

    await handleTelegramUpdate(callbackUpdate(2, `pub:${opportunity.id}`, 111), {
      store,
      ai: fakeAI(),
      env: testEnv(),
      messenger,
    });

    const published = await store.getOpportunityById(opportunity.id);
    expect(published?.status).toBe('published');
    expect(published?.published_at).toBeTruthy();
    expect(messenger.edits[0].text).toMatch(/Published/);
    expect(messenger.edits[0].text).toContain(`${SITE_URL}/opportunities/${opportunity.slug}`);
  });

  it('rejects a callback for an unknown opportunity without changing anything', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();
    await handleTelegramUpdate(callbackUpdate(1, 'pub:00000000-0000-4000-8000-000000000000', 111), {
      store,
      ai: fakeAI(),
      env: testEnv(),
      messenger,
    });
    expect(store.opportunities).toHaveLength(0);
    expect(messenger.edits[0].text).toMatch(/no longer exists/i);
  });

  it('reports extraction failures with a preserved admin review link', async () => {
    const { store } = await seedStore();
    const messenger = new RecordingMessenger();
    const failing = {
      name: 'failing',
      async extract(): Promise<unknown> {
        throw new Error('Model returned malformed JSON.');
      },
    };

    await handleTelegramUpdate(messageUpdate(1, `${SOURCE_URL}\n${SAMPLE_TEXT}`), {
      store,
      ai: failing,
      env: testEnv(),
      messenger,
    });

    expect(store.captures[0].status).toBe('extraction_failed');
    expect(store.captures[0].raw_text).toBe(SAMPLE_TEXT);
    expect(messenger.sent.some((entry) => entry.text.includes('/admin/captures/'))).toBe(true);
  });
});
