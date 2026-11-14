import type { APIRoute } from 'astro';
import { createAIProvider } from '../../../lib/ai/gemini';
import { TelegramClient } from '../../../lib/telegram/client';
import { handleTelegramUpdate, type TelegramUpdate } from '../../../lib/telegram/service';
import { requireStore } from '../../../lib/services/context';
import { jsonResponse } from '../../../lib/http';
import { isTelegramConfigured } from '../../../lib/env';

/** Constant-time comparison for the webhook secret. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const POST: APIRoute = async (context) => {
  const env = context.locals.env;
  if (!isTelegramConfigured(env) || !env.telegramBotToken || !env.telegramWebhookSecret) {
    return jsonResponse({ error: 'Telegram is not configured.' }, 503);
  }

  const secret = context.request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!safeEqual(secret, env.telegramWebhookSecret)) {
    // Do not reveal whether the webhook exists or whether the secret was close.
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  let update: TelegramUpdate;
  try {
    update = (await context.request.json()) as TelegramUpdate;
  } catch {
    return jsonResponse({ error: 'Invalid update payload.' }, 400);
  }
  if (!update || typeof update.update_id !== 'number') {
    return jsonResponse({ error: 'Invalid update payload.' }, 400);
  }

  try {
    const store = requireStore(env);
    const ai = createAIProvider(env);
    const messenger = new TelegramClient(env.telegramBotToken);
    await handleTelegramUpdate(update, { store, ai, env, messenger });
    return jsonResponse({ ok: true });
  } catch (error) {
    // The update may already be claimed. Log safely and acknowledge so Telegram
    // does not retry indefinitely; the capture remains available in admin.
    console.error('telegram webhook failure', error instanceof Error ? error.message : 'unknown error');
    return jsonResponse({ ok: true });
  }
};

export const GET: APIRoute = () => jsonResponse({ error: 'Method not allowed' }, 405);
