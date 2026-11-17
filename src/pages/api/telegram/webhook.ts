import type { APIRoute } from 'astro';
import { waitUntil } from '@vercel/functions';
import { createAIProvider } from '../../../lib/ai';
import { TelegramClient } from '../../../lib/telegram/client';
import { handleTelegramUpdate, type TelegramUpdate } from '../../../lib/telegram/service';
import { requireStore } from '../../../lib/services/context';
import { jsonResponse } from '../../../lib/http';
import { isTelegramConfigured } from '../../../lib/env';
import { createRetrievalService } from '../../../lib/linkedin/jsonld';

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
    return jsonResponse({ error: 'Invalid webhook secret.' }, 403);
  }

  const body = await context.request.json();
  const update: TelegramUpdate = {
    update_id: body.update_id,
    message: body.message
      ? {
          message_id: body.message.message_id,
          from: body.message.from ?? undefined,
          chat: body.message.chat ?? { id: 0, type: 'private' },
          text: body.message.text ?? undefined,
        }
      : undefined,
    callback_query: body.callback_query ?? undefined,
    edited_message: body.edited_message ?? undefined,
  };

  const store = requireStore(env);
  const ai = createAIProvider(env);
  const messenger = new TelegramClient(env.telegramBotToken);
  const retrieval = createRetrievalService(env);

  // Reliable background processing on Vercel:
  // waitUntil keeps the lambda execution alive until handleTelegramUpdate resolves,
  // without blocking the immediate 200 HTTP response to Telegram.
  try {
    waitUntil(
      handleTelegramUpdate(update, { store, ai, env, messenger, retrieval }).catch((e) => {
        console.error('Telegram background processing error:', e);
      }),
    );
  } catch {
    // Fallback if running outside Vercel function environment
    handleTelegramUpdate(update, { store, ai, env, messenger, retrieval }).catch((e) => {
      console.error('Telegram processing error:', e);
    });
  }

  return jsonResponse({ ok: true }, 200);
};
