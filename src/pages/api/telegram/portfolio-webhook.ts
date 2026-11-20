import type { APIRoute } from 'astro';
import { waitUntil } from '@vercel/functions';
import { jsonResponse } from '../../../lib/http';
import { isPortfolioControlBotConfigured } from '../../../lib/env';
import { requireStore } from '../../../lib/services/context';
import { TelegramClient } from '../../../lib/telegram/client';
import type { TelegramUpdate } from '../../../lib/telegram/service';
import { handlePortfolioBotUpdate } from '../../../lib/portfolio/control-bot';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.env;
  if (!isPortfolioControlBotConfigured(env) || !env.portfolioTelegramBotToken || !env.portfolioTelegramWebhookSecret) {
    return jsonResponse({ error: 'Portfolio control bot is not configured.' }, 503);
  }
  const suppliedSecret = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!safeEqual(suppliedSecret, env.portfolioTelegramWebhookSecret)) return jsonResponse({ error: 'Invalid webhook secret.' }, 403);

  let update: TelegramUpdate;
  try { update = await request.json() as TelegramUpdate; }
  catch { return jsonResponse({ error: 'Invalid Telegram update.' }, 400); }
  if (!Number.isSafeInteger(update.update_id)) return jsonResponse({ error: 'Invalid Telegram update ID.' }, 400);

  const store = requireStore(env);
  const messenger = new TelegramClient(env.portfolioTelegramBotToken);
  const work = handlePortfolioBotUpdate(update, { env, store, messenger }).catch((error) => {
    console.error('[portfolio-bot] update failed', { updateId: update.update_id, reason: error instanceof Error ? error.message.slice(0, 250) : 'Unknown failure.' });
  });
  try { waitUntil(work); } catch { void work; }
  return jsonResponse({ ok: true }, 200);
};
