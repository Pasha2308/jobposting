import type { AppEnv } from '../env';
import type { Store } from '../store/types';
import type { Messenger, TelegramButton } from '../telegram/client';
import { TelegramClient, TelegramError } from '../telegram/client';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendWithRateLimitRetry(messenger: Messenger, chatId: number, text: string) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await messenger.sendMessage(chatId, text.slice(0, 3900), { disable_web_page_preview: true }); }
    catch (error) {
      if (!(error instanceof TelegramError) || error.status !== 429 || error.retryAfter == null || attempt >= 3) throw error;
      const delayMs = Math.max(1_000, error.retryAfter * 1_000 + 250);
      // Avoid holding a serverless invocation open for a long retry_after. The
      // failed row remains retryable for the existing worker or admin retry.
      if (delayMs > 10_000) throw error;
      await wait(delayMs);
    }
  }
}

export async function dispatchPortfolioDelivery(env: AppEnv, store: Store) {
  if (!env.portfolioTelegramBotToken || !env.portfolioTelegramChatId) return { sent: 0, failed: 0, batchNumber: null };
  const chatId = Number(env.portfolioTelegramChatId);
  if (!Number.isSafeInteger(chatId) || chatId === 0 || !(await store.isPortfolioChatVerified(chatId))) {
    return { sent: 0, failed: 0, batchNumber: null };
  }
  return deliverNextLinkedInBatch(env, store, new TelegramClient(env.portfolioTelegramBotToken));
}

export async function deliverNextLinkedInBatch(
  env: AppEnv,
  store: Store,
  messenger: Messenger,
  chatId = Number(env.portfolioTelegramChatId),
  paceMs = 1_100,
): Promise<{ sent: number; failed: number; batchNumber: number | null }> {
  if (!Number.isSafeInteger(chatId) || chatId === 0) throw new Error('Portfolio bot chat is not configured.');
  const claimed = await store.claimNextLinkedInDeliveryBatch(30);
  if (!claimed.length) {
    const current = await store.currentLinkedInDeliveryBatch();
    const counts = await store.linkedinDeliveryCounts();
    if (current != null && (counts.failed || counts.sending)) {
      const retryButton: TelegramButton = { text: 'RETRY FAILED POSTS', callback_data: `portfolio_retry:${current}` };
      await messenger.sendMessage(chatId, `Batch ${current} has failed or unfinished posts. They must be delivered before the queue can advance.`, { reply_markup: { inline_keyboard: [[retryButton]] } });
    } else if (current != null && counts.sent) {
      await messenger.sendMessage(chatId, `Batch ${current} is already delivered. Use /done to acknowledge it and receive the next batch.`);
    } else {
      await messenger.sendMessage(chatId, 'The LinkedIn delivery queue is empty.');
    }
    return { sent: 0, failed: 0, batchNumber: current };
  }

  const batchNumber = claimed[0].batch_number;
  let sent = 0;
  let failed = 0;
  for (let index = 0; index < claimed.length; index += 1) {
    const item = claimed[index];
    try {
      const opportunity = await store.getOpportunityById(item.opportunity_id);
      if (!opportunity || opportunity.status !== 'published' || !opportunity.published_at || !opportunity.linkedin_post_draft) {
        throw new Error('Published job or saved LinkedIn draft is unavailable.');
      }
      const publicUrl = `${env.siteUrl.replace(/\/+$/, '')}/opportunities/${opportunity.job_code ?? opportunity.slug}`;
      const text = `📌 ${opportunity.title} · ${opportunity.job_code ?? opportunity.slug}\n\n${opportunity.linkedin_post_draft}\n\nPublic job page: ${publicUrl}`;
      const message = await sendWithRateLimitRetry(messenger, chatId, text);
      await store.setLinkedInDeliveryState(opportunity.id, 'sent', { telegramMessageId: message.message_id });
      sent += 1;
      if (index < claimed.length - 1 && paceMs > 0) await wait(paceMs);
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message.slice(0, 300) : 'Telegram delivery failed.';
      const retryable = error instanceof TelegramError && error.status === 429;
      const uncertain = error instanceof TelegramError && error.status >= 500;
      await store.setLinkedInDeliveryState(item.opportunity_id, 'failed', { error: reason, retryable });
      for (const remaining of claimed.slice(index + 1)) {
        await store.setLinkedInDeliveryState(remaining.opportunity_id, 'failed', { error: 'Batch paused before delivery after an earlier failure.', retryable: true });
      }
      const retryButton: TelegramButton = { text: 'CHECK / RETRY FAILED POSTS', callback_data: `portfolio_retry:${batchNumber}` };
      const uncertainty = uncertain ? ' Telegram did not confirm whether that post was accepted. Check the chat before retrying to avoid a duplicate.' : '';
      await messenger.sendMessage(chatId, `Delivery stopped at ${index + 1}/${claimed.length}. Failed and undelivered posts remain in this batch.${uncertainty} Retry before advancing.`, { reply_markup: { inline_keyboard: [[retryButton]] } });
      return { sent, failed, batchNumber };
    }
  }

  const doneButton: TelegramButton = { text: 'DONE — SEND NEXT 30', callback_data: `portfolio_done:${batchNumber}` };
  await messenger.sendMessage(chatId, `Batch ${batchNumber}: sent ${sent} LinkedIn drafts. They are delivered to Telegram only; none were posted to LinkedIn.`, { reply_markup: { inline_keyboard: [[doneButton]] } });
  return { sent, failed, batchNumber };
}

export async function acknowledgeAndContinue(env: AppEnv, store: Store, messenger: Messenger, batchNumber?: number, paceMs = 1_100): Promise<void> {
  const current = batchNumber ?? await store.currentLinkedInDeliveryBatch();
  if (current == null) {
    await deliverNextLinkedInBatch(env, store, messenger, undefined, paceMs);
    return;
  }
  const acknowledged = await store.acknowledgeLinkedInDeliveryBatch(current);
  if (!acknowledged) {
    const counts = await store.linkedinDeliveryCounts();
    const options = counts.failed
      ? { reply_markup: { inline_keyboard: [[{ text: 'CHECK / RETRY FAILED POSTS', callback_data: `portfolio_retry:${current}` }]] } }
      : {};
    await messenger.sendMessage(Number(env.portfolioTelegramChatId), `Batch ${current} was already acknowledged or still has failed/unfinished posts. No new batch was started.`, options);
    return;
  }
  await deliverNextLinkedInBatch(env, store, messenger, undefined, paceMs);
}
