import type { AppEnv } from '../env';
import type { Store } from '../store/types';
import type { Messenger, TelegramButton } from '../telegram/client';
import { TelegramError } from '../telegram/client';
import { opportunityPublicId } from '../domain/url';
import { buildXDraft } from './x-draft';

export async function deliverNextXBatch(env: AppEnv, store: Store, messenger: Messenger, chatId = Number(env.portfolioTelegramChatId)) {
  const claimed = await store.claimNextXDeliveryBatch(10);
  if (!claimed.length) {
    const current = await store.currentXDeliveryBatch();
    const counts = await store.xDeliveryCounts();
    if (current != null && counts.sent) await messenger.sendMessage(chatId, `X batch ${current} is delivered. Use /done_x to acknowledge it.`);
    else if (current != null && (counts.failed || counts.sending)) await messenger.sendMessage(chatId, `X batch ${current} has unfinished posts. Use /retry_x.`);
    else await messenger.sendMessage(chatId, 'The X draft queue is empty. One X draft is queued for every three published jobs.');
    return { sent: 0, failed: 0, batchNumber: current };
  }
  const batchNumber = claimed[0].batch_number;
  let sent = 0;
  for (let index = 0; index < claimed.length; index += 1) {
    const item = claimed[index];
    try {
      const opportunity = await store.getOpportunityById(item.opportunity_id);
      if (!opportunity || opportunity.status !== 'published') throw new Error('Published job is unavailable.');
      const url = `${env.siteUrl.replace(/\/+$/, '')}/opportunities/${opportunityPublicId(opportunity)}`;
      const message = await messenger.sendMessage(chatId, `𝕏 Ready-to-copy post · ${opportunity.job_code ?? opportunity.slug}\n\n${buildXDraft(opportunity, url)}`, { disable_web_page_preview: true });
      await store.setXDeliveryState(item.opportunity_id, 'sent', { telegramMessageId: message.message_id }); sent += 1;
    } catch (error) {
      const retryable = error instanceof TelegramError && error.status === 429;
      await store.setXDeliveryState(item.opportunity_id, 'failed', { error: error instanceof Error ? error.message : 'Delivery failed.', retryable });
      for (const remaining of claimed.slice(index + 1)) await store.setXDeliveryState(remaining.opportunity_id, 'failed', { error: 'Batch paused.', retryable: true });
      const retry: TelegramButton = { text: 'RETRY X POSTS', callback_data: `portfolio_x_retry:${batchNumber}` };
      await messenger.sendMessage(chatId, `X delivery stopped at ${index + 1}/${claimed.length}.`, { reply_markup: { inline_keyboard: [[retry]] } });
      return { sent, failed: 1, batchNumber };
    }
  }
  const done: TelegramButton = { text: 'DONE WITH X BATCH', callback_data: `portfolio_x_done:${batchNumber}` };
  await messenger.sendMessage(chatId, `X batch ${batchNumber}: sent ${sent} ready-to-copy drafts.`, { reply_markup: { inline_keyboard: [[done]] } });
  return { sent, failed: 0, batchNumber };
}

export async function acknowledgeXAndContinue(env: AppEnv, store: Store, messenger: Messenger, batchNumber?: number) {
  const current = batchNumber ?? await store.currentXDeliveryBatch();
  if (current != null && !(await store.acknowledgeXDeliveryBatch(current))) {
    await messenger.sendMessage(Number(env.portfolioTelegramChatId), 'The active X batch still has unfinished posts. Use /retry_x first.'); return;
  }
  await deliverNextXBatch(env, store, messenger);
}
