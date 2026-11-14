import type { APIRoute } from 'astro';
import { isTelegramConfigured } from '../../../../lib/env';
import { requireStore } from '../../../../lib/services/context';
import { ServiceError } from '../../../../lib/services/errors';
import { apiError, assertSameOrigin, jsonResponse } from '../../../../lib/http';

async function telegramApi(token: string, method: string, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => null)) as { ok?: boolean; description?: string; result?: unknown } | null;
  return { ok: Boolean(response.ok && data?.ok), description: data?.description ?? null, result: data?.result };
}

export const POST: APIRoute = async (context) => {
  try {
    assertSameOrigin(context.request, context.locals.env);
    const store = requireStore(context.locals.env);
    const admin = context.locals.admin;
    if (!admin) throw new ServiceError('unauthorised', 'Sign in required.', 401);
    const env = context.locals.env;
    if (!isTelegramConfigured(env) || !env.telegramBotToken || !env.telegramWebhookSecret) {
      throw new ServiceError(
        'telegram_not_configured',
        'Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and TELEGRAM_ADMIN_USER_IDS before registering the webhook.',
        503,
      );
    }

    const webhookUrl = `${env.siteUrl.replace(/\/+$/, '')}/api/telegram/webhook`;
    const result = await telegramApi(env.telegramBotToken, 'setWebhook', {
      url: webhookUrl,
      secret_token: env.telegramWebhookSecret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });

    await store.logActivity({
      actor: `admin:${admin.email}`,
      action: 'telegram.webhook_registered',
      entity_type: 'telegram',
      metadata: { ok: result.ok, url: webhookUrl },
    });

    if (!result.ok) {
      throw new ServiceError('telegram_error', result.description ?? 'Telegram rejected the webhook registration.', 502);
    }
    return jsonResponse({ ok: true, url: webhookUrl, description: result.description });
  } catch (error) {
    return apiError(error);
  }
};

export const GET: APIRoute = async (context) => {
  try {
    const admin = context.locals.admin;
    if (!admin) throw new ServiceError('unauthorised', 'Sign in required.', 401);
    const env = context.locals.env;
    if (!env.telegramBotToken) throw new ServiceError('telegram_not_configured', 'Telegram token is missing.', 503);
    const result = await telegramApi(env.telegramBotToken, 'getWebhookInfo', {});
    return jsonResponse({ ok: result.ok, info: result.result, description: result.description });
  } catch (error) {
    return apiError(error);
  }
};
