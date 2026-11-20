import type { APIRoute } from 'astro';
import { isPortfolioControlBotConfigured } from '../../../../lib/env';
import { apiError, assertSameOrigin, jsonResponse } from '../../../../lib/http';
import { requireStore } from '../../../../lib/services/context';
import { ServiceError } from '../../../../lib/services/errors';

async function telegramApi(token: string, method: string, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null) as { ok?: boolean; description?: string; result?: unknown } | null;
  return { ok: Boolean(response.ok && data?.ok), description: data?.description ?? null, result: data?.result };
}

export const POST: APIRoute = async (context) => {
  try {
    assertSameOrigin(context.request, context.locals.env);
    const admin = context.locals.admin;
    if (!admin) throw new ServiceError('unauthorised', 'Sign in required.', 401);
    const env = context.locals.env;
    if (!isPortfolioControlBotConfigured(env) || !env.portfolioTelegramBotToken || !env.portfolioTelegramWebhookSecret) {
      throw new ServiceError('telegram_not_configured', 'Set PORTFOLIO_TELEGRAM_BOT_TOKEN, PORTFOLIO_TELEGRAM_CHAT_ID and PORTFOLIO_TELEGRAM_WEBHOOK_SECRET first.', 503);
    }
    const url = `${env.siteUrl.replace(/\/+$/, '')}/api/telegram/portfolio-webhook`;
    const result = await telegramApi(env.portfolioTelegramBotToken, 'setWebhook', {
      url,
      secret_token: env.portfolioTelegramWebhookSecret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
    await requireStore(env).logActivity({ actor: `admin:${admin.email}`, action: 'telegram.portfolio_webhook_registered', entity_type: 'telegram', metadata: { ok: result.ok, url } });
    if (!result.ok) throw new ServiceError('telegram_error', result.description ?? 'Telegram rejected webhook registration.', 502);
    return jsonResponse({ ok: true, url, description: result.description });
  } catch (error) { return apiError(error); }
};

export const GET: APIRoute = async (context) => {
  try {
    const admin = context.locals.admin;
    if (!admin) throw new ServiceError('unauthorised', 'Sign in required.', 401);
    const token = context.locals.env.portfolioTelegramBotToken;
    if (!token) throw new ServiceError('telegram_not_configured', 'Portfolio bot token is missing.', 503);
    const result = await telegramApi(token, 'getWebhookInfo', {});
    return jsonResponse({ ok: result.ok, info: result.result, description: result.description });
  } catch (error) { return apiError(error); }
};
