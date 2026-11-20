import type { AppEnv } from '../env';
import type { Store } from '../store/types';
import type { TelegramUpdate } from '../telegram/service';
import type { Messenger, TelegramButton } from '../telegram/client';
import { discoverPortfolioJobs } from './getro';
import { acknowledgeAndContinue, deliverNextLinkedInBatch } from './linkedin-delivery';

type BotDeps = { env: AppEnv; store: Store; messenger: Messenger; fetcher?: typeof fetch };

function configuredChat(env: AppEnv): number | null {
  const parsed = Number(env.portfolioTelegramChatId);
  return Number.isSafeInteger(parsed) && parsed !== 0 ? parsed : null;
}

function isAdmin(env: AppEnv, userId: number | undefined): userId is number {
  return typeof userId === 'number' && env.portfolioTelegramAdminIds.includes(userId);
}

function startKeyboard(): { inline_keyboard: TelegramButton[][] } {
  return { inline_keyboard: [[{ text: 'FETCH JOBS', callback_data: 'portfolio_fetch' }]] };
}

export async function handlePortfolioBotUpdate(update: TelegramUpdate, deps: BotDeps): Promise<void> {
  const { env, store, messenger } = deps;
  const message = update.message;
  const callback = update.callback_query;
  const user = message?.from ?? callback?.from;
  const chatId = message?.chat.id ?? callback?.message?.chat.id;
  if (!user || !chatId) return;
  const kind = callback ? 'callback_query' : message ? 'message' : 'other';
  if (!(await store.claimTelegramUpdate(update.update_id, user.id, kind, 'portfolio'))) return;

  if (!isAdmin(env, user.id)) {
    await messenger.sendMessage(chatId, 'This control bot is restricted to allowlisted admin accounts.');
    return;
  }

  if (callback) {
    const verified = await store.getPortfolioAdminChat(user.id);
    if (verified !== chatId || configuredChat(env) !== chatId) {
      await messenger.answerCallbackQuery(callback.id, 'Run /start in the configured admin chat first.');
      return;
    }
    await messenger.answerCallbackQuery(callback.id);
    const data = callback.data ?? '';
    if (data === 'portfolio_fetch') await runFetch(user.id, chatId, deps);
    else if (data.startsWith('portfolio_done:')) {
      const batch = Number(data.slice('portfolio_done:'.length));
      await acknowledgeAndContinue(env, store, messenger, Number.isSafeInteger(batch) ? batch : undefined);
    } else if (data.startsWith('portfolio_retry:')) {
      const retryBatch = Number(data.slice('portfolio_retry:'.length));
      if (!Number.isSafeInteger(retryBatch) || await store.currentLinkedInDeliveryBatch() !== retryBatch) {
        await messenger.sendMessage(chatId, 'That retry button is no longer for the active batch. Use /status for the current queue.');
      } else {
        await store.prepareLinkedInDeliveryRetry(retryBatch);
        await deliverNextLinkedInBatch(env, store, messenger, chatId);
      }
    }
    return;
  }

  const text = message?.text?.trim() ?? '';
  const command = text.split(/\s+/, 1)[0].toLowerCase().split('@', 1)[0];
  if (command === '/start') {
    const expectedChat = configuredChat(env);
    if (expectedChat == null || chatId !== expectedChat) {
      await messenger.sendMessage(chatId, 'This is not the configured portfolio admin chat. Set PORTFOLIO_TELEGRAM_CHAT_ID to this chat ID, then send /start again.');
      return;
    }
    await store.setPortfolioAdminChat(user.id, chatId);
    await messenger.sendMessage(chatId, 'Portfolio control bot is ready. /fetch starts a manual job search, /status shows progress, and /done acknowledges the current LinkedIn draft batch.', { reply_markup: startKeyboard() });
    return;
  }

  const verified = await store.getPortfolioAdminChat(user.id);
  if (verified !== chatId || configuredChat(env) !== chatId) {
    await messenger.sendMessage(chatId, 'Verify this admin chat first by sending /start from the configured chat.');
    return;
  }
  if (command === '/fetch') await runFetch(user.id, chatId, deps);
  else if (command === '/status') await sendStatus(chatId, deps);
  else if (command === '/done') await acknowledgeAndContinue(env, store, messenger);
  else await messenger.sendMessage(chatId, 'Commands: /start, /fetch, /status, /done.');
}

async function runFetch(userId: number, chatId: number, deps: BotDeps): Promise<void> {
  const { env, store, messenger } = deps;
  // The two-day first-scan window is intentional: public feeds can contain
  // hundreds of old postings and a historical import can outlive one webhook
  // invocation. Later runs use source checkpoints and still read every new item.
  const fullBackfill = false;
  const runId = await store.startPortfolioSearch(userId, fullBackfill);
  if (!runId) {
    await messenger.sendMessage(chatId, 'A job search is already running. Use /status to check its progress.');
    return;
  }
  // Starting the scan must not wait on an external Telegram send. The webhook
  // has already acknowledged the update; keep the operator notice best-effort.
  void messenger.sendMessage(chatId, fullBackfill ? 'Starting the initial full backfill of enabled, authorized sources…' : 'Starting a manual scan for new jobs from the last successful source checkpoints…')
    .catch((error) => console.warn('[portfolio-bot] FETCH acknowledgement failed; continuing discovery', {
      reason: error instanceof Error ? error.message.slice(0, 200) : 'Telegram send failed.',
    }));
  try {
    const result = await discoverPortfolioJobs(env, store, {
      manual: true,
      fullBackfill,
      ...(deps.fetcher ? { fetcher: deps.fetcher } : {}),
      onProgress: async (report) => {
        await store.updatePortfolioSearchProgress(runId, report).catch((error) => {
          console.error('[portfolio-bot] search progress could not be saved', { runId, reason: error instanceof Error ? error.message.slice(0, 200) : 'Unknown persistence error.' });
        });
      },
    });
    const status = result.failures.length ? (result.scanned ? 'partial' : 'failed') : result.scanned ? 'completed' : 'failed';
    const report = {
      scanned: result.scanned,
      created: result.created,
      readyForReview: result.readyForReview,
      heldForInformation: result.heldForInformation,
      duplicatesSkipped: result.duplicatesSkipped,
      scannedSources: result.scannedSources,
      failures: result.failures,
    };
    await store.finishPortfolioSearch(runId, status, report);
    const lines = [
      `Search ${status}.`,
      `Sources successfully scanned: ${result.scanned}${result.scannedSources.length ? ` (${result.scannedSources.join(', ')})` : ''}`,
      `New jobs found: ${result.created}`,
      `Ready for review: ${result.readyForReview}`,
      result.heldForInformation ? `Held for missing or unverified details: ${result.heldForInformation}` : null,
      `Duplicates skipped: ${result.duplicatesSkipped}`,
      result.failures.length ? `Failed sources: ${result.failures.join('; ')}` : null,
      'Sources without owner-authorized or verified access were not searched.',
    ].filter((line): line is string => Boolean(line));
    await messenger.sendMessage(chatId, lines.join('\n'));
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 250) : 'Search failed unexpectedly.';
    await store.finishPortfolioSearch(runId, 'failed', { error: reason });
    await messenger.sendMessage(chatId, `Search failed. Source checkpoints were not advanced for incomplete sources. ${reason}`);
  }
}

async function sendStatus(chatId: number, { store, messenger }: BotDeps): Promise<void> {
  const [run, pending, delivery, missingDrafts] = await Promise.all([
    store.latestPortfolioSearch(),
    store.listAdmin({ status: 'pending_review', page: 1, pageSize: 1 }),
    store.linkedinDeliveryCounts(),
    store.countPublishedWithoutLinkedInDraft(),
  ]);
  const report = run?.report ?? {};
  const failures = Array.isArray(report.failures) ? report.failures.join('; ') : 'None';
  const scannedSources = Array.isArray(report.scannedSources) ? report.scannedSources.join(', ') : 'None';
  const text = [
    `Latest search: ${run?.status ?? 'not run'}${run?.started_at ? ` · ${run.started_at}` : ''}`,
    `Sources scanned: ${String(report.scanned ?? 0)} (${scannedSources})`,
    run?.status === 'running' && report.currentSource ? `Currently scanning: ${String(report.currentSource)}` : null,
    `Search failures: ${failures || 'None'}`,
    `Jobs discovered: ${String(report.created ?? 0)}`,
    `Ready for review: ${String(report.readyForReview ?? 0)}`,
    `Held for information: ${String(report.heldForInformation ?? 0)}`,
    `Duplicates skipped: ${String(report.duplicatesSkipped ?? 0)}`,
    `Pending admin review: ${pending.total}`,
    `Published opportunities awaiting LinkedIn drafts: ${missingDrafts}`,
    `Published jobs awaiting Telegram delivery: ${delivery.queued + delivery.failed + delivery.sending}`,
    `Telegram posts delivered: ${delivery.sent + delivery.acknowledged}`,
    `Delivered posts awaiting acknowledgement: ${delivery.sent}`,
    `Posts acknowledged: ${delivery.acknowledged}`,
    `Failed notifications: ${delivery.failed}`,
  ].filter((line): line is string => Boolean(line)).join('\n');
  await messenger.sendMessage(chatId, text);
}
