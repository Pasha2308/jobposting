import type { AIProvider } from '../ai/provider';
import type { AppEnv } from '../env';
import type { Store } from '../store/types';
import type { OpportunityWithRelations, SourceCapture } from '../domain/types';
import { canonicalSourceKey, extractLinkedInPostId, isLinkedInPostUrl, normalizeSourceUrl } from '../domain/url';
import { generateComments } from '../domain/comments';
import { processCapture, submitCapture, textSourceKey } from '../services/capture';
import { ingestLinkedInUrl } from '../services/ingest-source';
import { createRetrievalService } from '../linkedin/jsonld';
import type { RetrievalFn } from '../linkedin/types';
import { publishOpportunity, transitionOpportunity } from '../services/publishing';
import { refreshComments } from '../services/comments';
import { ServiceError } from '../services/errors';
import { escapeHtml, type Messenger } from './client';

type TelegramUser = { id: number; is_bot?: boolean; first_name?: string; username?: string };
type TelegramChat = { id: number; type: string };
type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
};
type TelegramCallback = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};
export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallback;
  edited_message?: TelegramMessage;
};

const HELP = [
  '<b>Hustler Community — Opportunity capture</b>',
  '',
  'Send one LinkedIn post URL:',
  '',
  '<code>https://www.linkedin.com/posts/...</code>',
  '',
  'I save the link first, retrieve the post when authorised, extract every',
  'opening separately, and show a preview with approve/reject buttons.',
  '',
  'If LinkedIn requires sign-in or retrieval is not authorised, the link is',
  'kept and I will ask for the copied post text once:',
  '',
  '<code>https://www.linkedin.com/posts/...</code>',
  '<code>We are hiring a Founder Associate...</code>',
  '',
  'Commands: /help, /id',
].join('\n');

export type TelegramDeps = {
  store: Store;
  ai: AIProvider | null;
  env: AppEnv;
  messenger: Messenger;
  /** Injectable for tests; defaults to the configured adapter. */
  retrieval?: RetrievalFn;
};

/**
 * Processes a webhook update exactly once (update ids are claimed in the
 * database). Publishing goes through the same service as the admin UI.
 */
export async function handleTelegramUpdate(update: TelegramUpdate, deps: TelegramDeps): Promise<void> {
  const { store, env, messenger } = deps;

  const actorUser = update.message?.from ?? update.callback_query?.from ?? update.edited_message?.from;
  const updateType = update.callback_query ? 'callback_query' : update.message ? 'message' : 'other';
  const claimed = await store.claimTelegramUpdate(update.update_id, actorUser?.id ?? null, updateType);
  if (!claimed) return;

  if (!actorUser) return;
  if (!env.telegramAdminIds.includes(actorUser.id)) {
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId) await messenger.sendMessage(chatId, 'This bot is private. Your Telegram user ID is not on the allowlist.');
    return;
  }

  if (update.callback_query) {
    await handleCallback(update.callback_query, deps);
    return;
  }

  const message = update.message ?? update.edited_message;
  if (!message?.text) return;

  try {
    await handleMessage(message, deps);
  } catch (error) {
    const safe = error instanceof ServiceError ? error.message : 'Something went wrong while processing the message.';
    await messenger
      .sendMessage(message.chat.id, `⚠️ ${escapeHtml(safe)}`, { parse_mode: 'HTML' })
      .catch(() => undefined);
  }
}

async function handleMessage(message: TelegramMessage, deps: TelegramDeps): Promise<void> {
  const { store, ai, env, messenger } = deps;
  const text = message.text?.trim() ?? '';
  const chatId = message.chat.id;
  const userId = message.from?.id;
  if (!userId) return;

  if (text === '/start' || text === '/help') {
    await messenger.sendMessage(chatId, HELP, { parse_mode: 'HTML', disable_web_page_preview: true });
    return;
  }

  if (text === '/id') {
    await messenger.sendMessage(chatId, `Your Telegram user ID: <code>${userId}</code>`, { parse_mode: 'HTML' });
    return;
  }

  const urlMatch = text.match(/https?:\/\/[^\s<>"']+/i);
  const urlCandidate = urlMatch?.[0]?.replace(/[),.;!?]+$/, '') ?? null;
  const bodyWithoutUrl = urlMatch ? text.replace(urlMatch[0], '').trim() : text;

  // Second message for a capture created from a URL-only message. A URL plus
  // text only attaches to the pending capture when it is the same post, so a
  // new submission can never overwrite another post's preserved source.
  const awaiting = await store.findAwaitingCapture(userId, 30);
  const candidateNormalized = urlCandidate ? normalizeSourceUrl(urlCandidate) : null;
  const candidateIsLinkedInPost = Boolean(candidateNormalized && isLinkedInPostUrl(candidateNormalized));
  const candidateKey =
    candidateNormalized && candidateIsLinkedInPost
      ? canonicalSourceKey(candidateNormalized, extractLinkedInPostId(candidateNormalized))
      : null;
  // A pasted post body often contains application links. Only a *LinkedIn post*
  // URL can redirect the text to a different capture; any other link is treated
  // as part of the copied text.
  const samePendingSource = !candidateIsLinkedInPost || candidateKey === awaiting?.normalized_source_key;
  if (
    awaiting &&
    text.length >= 40 &&
    samePendingSource &&
    (!urlCandidate || bodyWithoutUrl.length >= 40)
  ) {
    await store.updateCapture(awaiting.id, {
      raw_text: text,
      status: 'received',
      retrieval_status: 'retrieved',
      retrieval_method: 'manual_text',
      retrieved_at: new Date().toISOString(),
      next_retry_at: null,
      retrieval_error_code: null,
      error_message: null,
      processing_started_at: null,
    });
    await messenger.sendMessage(chatId, 'Extracting the opportunity…');
    try {
      const result = await processCapture(store, ai, awaiting.id, {
        actor: `telegram:${userId}`,
        siteUrl: env.siteUrl,
      });
      const opps = result.opportunities && result.opportunities.length > 0
        ? result.opportunities
        : result.opportunity ? [result.opportunity] : [];
      if (opps.length > 0) {
        for (const opp of opps) {
          await sendPreview(chatId, result.capture, opp, result.warnings, deps);
        }
      } else {
        await messenger.sendMessage(
          chatId,
          `The AI did not identify a specific vacancy.\n\nReview and decide: ${env.siteUrl}/admin/captures/${awaiting.id}`,
          { disable_web_page_preview: true },
        );
      }
    } catch (error) {
      const link = `${env.siteUrl}/admin/captures/${awaiting.id}`;
      const safe = error instanceof ServiceError ? error.message : 'Extraction failed. The capture was preserved.';
      await messenger.sendMessage(chatId, `⚠️ ${escapeHtml(safe)}\n\nReview or retry: ${escapeHtml(link)}`, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    }
    return;
  }

  if (!urlCandidate) {
    await messenger.sendMessage(
      chatId,
      'Please send a post URL, or paste a URL followed by the post text.\nSend /help for examples.',
    );
    return;
  }

  const normalizedUrl = normalizeSourceUrl(urlCandidate);
  if (!normalizedUrl) {
    await messenger.sendMessage(chatId, 'That URL is not valid. Send a public http(s) URL.');
    return;
  }

  const postId = extractLinkedInPostId(normalizedUrl);
  const sourceKey = canonicalSourceKey(normalizedUrl, postId) ?? (await textSourceKey(text));

  const existing = await store.getCaptureBySourceKey(sourceKey);
  if (existing && !['rejected', 'extraction_failed', 'retrieval_failed'].includes(existing.status)) {
    const link = existing.opportunity_id
      ? `${env.siteUrl}/admin/opportunities/${existing.opportunity_id}`
      : `${env.siteUrl}/admin/captures/${existing.id}`;
    await messenger.sendMessage(
      chatId,
      `This source has already been captured (${escapeHtml(existing.status)}).\n${escapeHtml(link)}`,
      { parse_mode: 'HTML', disable_web_page_preview: true },
    );
    return;
  }

  // URL-first ingestion. The capture is persisted before retrieval, so the URL
  // survives any external failure. Copied text remains the fallback.
  if (bodyWithoutUrl.length < 40) {
    if (!isLinkedInPostUrl(normalizedUrl)) {
      await messenger.sendMessage(
        chatId,
        'Only links to specific LinkedIn posts can be ingested automatically.\nSend the post URL, or send a URL followed by the copied post text.',
      );
      return;
    }

    await messenger.sendMessage(chatId, 'Got the link. Saving it and retrieving the post…', {
      disable_web_page_preview: true,
    });

    const retrieval = deps.retrieval ?? createRetrievalService(env);
    try {
      const outcome = await ingestLinkedInUrl(
        store,
        ai,
        {
          sourceUrl: urlCandidate,
          actor: `telegram:${userId}`,
          telegramUserId: userId,
          telegramChatId: chatId,
          telegramMessageId: message.message_id,
        },
        retrieval,
        { siteUrl: env.siteUrl },
      );

      if (!outcome.ok) {
        if (outcome.errorCode === 'duplicate' && outcome.duplicate) {
          const link = outcome.duplicate.opportunityId
            ? `${env.siteUrl}/admin/opportunities/${outcome.duplicate.opportunityId}`
            : `${env.siteUrl}/admin/captures/${outcome.duplicate.captureId}`;
          await messenger.sendMessage(
            chatId,
            `This source has already been captured (${escapeHtml(outcome.duplicate.status)}).\n${escapeHtml(link)}`,
            { parse_mode: 'HTML', disable_web_page_preview: true },
          );
          return;
        }
        const review = outcome.capture
          ? `${env.siteUrl}/admin/captures/${outcome.capture.id}`
          : `${env.siteUrl}/admin/capture`;
        await messenger.sendMessage(
          chatId,
          `⚠️ ${escapeHtml(outcome.message)}\n\nSend the copied post text in one message within 30 minutes and I will extract every opening.\n\n${escapeHtml(review)}`,
          { parse_mode: 'HTML', disable_web_page_preview: true },
        );
        return;
      }

      const opps =
        outcome.result.opportunities && outcome.result.opportunities.length > 0
          ? outcome.result.opportunities
          : outcome.result.opportunity
            ? [outcome.result.opportunity]
            : [];
      if (opps.length > 0) {
        for (const opp of opps) {
          await sendPreview(chatId, outcome.result.capture, opp, outcome.result.warnings, deps);
        }
      } else {
        await messenger.sendMessage(
          chatId,
          `The AI did not identify a specific vacancy.\n\nReview and decide: ${env.siteUrl}/admin/captures/${outcome.capture.id}`,
          { disable_web_page_preview: true },
        );
      }
    } catch (error) {
      const stored = await store.getCaptureBySourceKey(sourceKey).catch(() => null);
      const link = stored ? `${env.siteUrl}/admin/captures/${stored.id}` : `${env.siteUrl}/admin/capture`;
      const safe = error instanceof ServiceError ? error.message : 'Processing failed. The capture was preserved.';
      await messenger.sendMessage(chatId, `⚠️ ${escapeHtml(safe)}\n\nReview or retry: ${escapeHtml(link)}`, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    }
    return;
  }

  // Full submission (URL + text in the same message).
  let capture: SourceCapture;
  try {
    const submitted = await submitCapture(store, {
      sourceUrl: normalizedUrl,
      rawText: bodyWithoutUrl,
      sourceType: 'linkedin_post',
      actor: `telegram:${userId}`,
      telegramUserId: userId,
      telegramChatId: chatId,
      telegramMessageId: message.message_id,
      preserveSourceUrl: true,
    });
    capture = submitted.capture;
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'duplicate') {
      const oppId = (error.details as { opportunityId?: string })?.opportunityId;
      const link = oppId ? `${env.siteUrl}/admin/opportunities/${oppId}` : `${env.siteUrl}/admin/captures`;
      await messenger.sendMessage(
        chatId,
        `This opportunity is already recorded in the database.\n${escapeHtml(link)}`,
        { disable_web_page_preview: true },
      );
      return;
    }
    throw error;
  }

  await messenger.sendMessage(chatId, 'Extracting the opportunity…');
  try {
    const result = await processCapture(store, ai, capture.id, {
      actor: `telegram:${userId}`,
      siteUrl: env.siteUrl,
    });
    const opps = result.opportunities && result.opportunities.length > 0
      ? result.opportunities
      : result.opportunity ? [result.opportunity] : [];
    if (opps.length > 0) {
      for (const opp of opps) {
        await sendPreview(chatId, result.capture, opp, result.warnings, deps);
      }
    } else {
      await messenger.sendMessage(
        chatId,
        `The AI did not identify a specific vacancy.\n\nReview and decide: ${env.siteUrl}/admin/captures/${capture.id}`,
        { disable_web_page_preview: true },
      );
    }
  } catch (error) {
    const link = `${env.siteUrl}/admin/captures/${capture.id}`;
    const safe = error instanceof ServiceError ? error.message : 'Extraction failed. The capture was preserved.';
    await messenger.sendMessage(chatId, `⚠️ ${escapeHtml(safe)}\n\nReview or retry: ${escapeHtml(link)}`, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }
}

async function handleCallback(callback: TelegramCallback, deps: TelegramDeps): Promise<void> {
  const { store, env, messenger } = deps;
  const data = callback.data ?? '';
  const userId = callback.from.id;
  const chatId = callback.message?.chat.id;
  const messageId = callback.message?.message_id;

  await messenger.answerCallbackQuery(callback.id, 'Working…').catch(() => undefined);
  if (!chatId || !messageId) return;

  const [action, opportunityId] = data.split(':');
  if (!action || !opportunityId) return;

  const opportunity = await store.getOpportunityById(opportunityId);
  if (!opportunity) {
    await messenger.editMessageText(chatId, messageId, 'This opportunity no longer exists.').catch(() => undefined);
    return;
  }

  // Callback ownership: a Telegram-created preview can only be actioned by the
  // user who submitted it. Any allowlisted admin can act on website records.
  if (opportunity.source_capture_id) {
    const capture = await store.getCapture(opportunity.source_capture_id);
    if (capture?.telegram_user_id && capture.telegram_user_id !== userId) {
      await messenger.answerCallbackQuery(callback.id, 'This preview belongs to another admin.').catch(() => undefined);
      return;
    }
  }

  try {
    if (action === 'pub') {
      const result = await publishOpportunity(store, opportunityId, `telegram:${userId}`, env.siteUrl);
      const pubNum = result.opportunity.publication_number ?? 1;
      const fixedComment = `Explore more ${pubNum} similar opportunities at Hustler Community: ${env.siteUrl.replace(/\/+$/, '')}/opportunities`;
      const text = [
        '✅ <b>Published</b>',
        escapeHtml(result.opportunity.title),
        '',
        `<a href="${escapeHtml(result.listingUrl)}">${escapeHtml(result.listingUrl)}</a>`,
        '',
        '<b>Standard LinkedIn comment:</b>',
        `<code>${escapeHtml(fixedComment)}</code>`,
      ].join('\n');
      await messenger.editMessageText(chatId, messageId, text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: 'Open admin review', url: `${env.siteUrl}/admin/opportunities/${opportunityId}` }]],
        },
      });
      return;
    }

    if (action === 'draft') {
      await transitionOpportunity(store, opportunityId, 'submit_for_review', `telegram:${userId}`, env.siteUrl).catch(
        () => undefined,
      );
      await store.logActivity({
        actor: `telegram:${userId}`,
        action: 'opportunity.saved_draft',
        entity_type: 'opportunity',
        entity_id: opportunityId,
      });
      await messenger.editMessageText(chatId, messageId, '📝 Saved as draft. Finish it in the admin review page.', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Open admin review', url: `${env.siteUrl}/admin/opportunities/${opportunityId}` }]],
        },
      });
      return;
    }

    if (action === 'rej') {
      await transitionOpportunity(store, opportunityId, 'reject', `telegram:${userId}`, env.siteUrl);
      if (opportunity.source_capture_id) {
        await store.updateCapture(opportunity.source_capture_id, { status: 'rejected' }).catch(() => undefined);
      }
      await messenger.editMessageText(chatId, messageId, '🗑 Rejected. The capture is preserved in the admin workspace.');
      return;
    }

    if (action === 'regen') {
      await refreshComments(store, opportunity, env.siteUrl);
      const comments = await store.listComments(opportunityId);
      const latest = latestComments(comments);
      const body = latest.map((c) => `<b>${escapeHtml(c.style)}</b>\n${escapeHtml(c.body)}`).join('\n\n');
      await messenger.editMessageText(chatId, messageId, body.slice(0, 3900), {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Approve & Publish', callback_data: `pub:${opportunityId}` },
              { text: 'Save Draft', callback_data: `draft:${opportunityId}` },
            ],
            [
              { text: 'Reject', callback_data: `rej:${opportunityId}` },
              { text: 'Regenerate Comment', callback_data: `regen:${opportunityId}` },
            ],
            [{ text: 'Open admin review', url: `${env.siteUrl}/admin/opportunities/${opportunityId}` }],
          ],
        },
      });
      return;
    }
  } catch (error) {
    const safe =
      error instanceof ServiceError
        ? error.message
        : 'That action failed. The record was not changed.';
    const blocking =
      error instanceof ServiceError && Array.isArray(error.details?.blocking)
        ? `\n\n${(error.details.blocking as string[]).map((b) => `• ${escapeHtml(b)}`).join('\n')}`
        : '';
    await messenger
      .editMessageText(
        chatId,
        messageId,
        `⚠️ ${escapeHtml(safe)}${blocking}\n\nFix the details in the admin review page:\n${escapeHtml(
          `${env.siteUrl}/admin/opportunities/${opportunityId}`,
        )}`,
        { parse_mode: 'HTML', disable_web_page_preview: true },
      )
      .catch(() => undefined);
  }
}

async function sendPreview(
  chatId: number,
  capture: SourceCapture,
  opportunity: OpportunityWithRelations | null,
  warnings: string[],
  deps: TelegramDeps,
): Promise<void> {
  const { store, env, messenger } = deps;
  if (!opportunity) {
    await messenger.sendMessage(
      chatId,
      `The AI did not identify a specific vacancy.\n\nReview and decide: ${env.siteUrl}/admin/captures/${capture.id}`,
      { disable_web_page_preview: true },
    );
    return;
  }

  const comments = latestComments(await store.listComments(opportunity.id));
  const comment = comments.find((c) => c.style === 'professional') ?? comments[0];
  const salary =
    opportunity.salary_min != null || opportunity.salary_max != null
      ? `${opportunity.currency ?? ''} ${opportunity.salary_min ?? ''}${opportunity.salary_max != null ? `–${opportunity.salary_max}` : ''}`.trim()
      : 'Not specified';

  const lines = [
    '🔎 <b>Opportunity preview</b>',
    `<b>${escapeHtml(opportunity.title)}</b>`,
    escapeHtml(
      [opportunity.company?.name ?? 'Company not set', opportunity.category?.name ?? 'Category not set'].join(' · '),
    ),
    escapeHtml(
      [
        opportunity.location_text ?? opportunity.city ?? opportunity.country ?? 'Location not specified',
        opportunity.work_mode,
        opportunity.employment_type,
      ].join(' · '),
    ),
    `Salary: ${escapeHtml(salary)}`,
    `Application: ${escapeHtml(opportunity.application_method)}`,
    '',
    escapeHtml(opportunity.summary ?? 'No summary extracted.'),
    '',
    comment ? `<b>Comment (${escapeHtml(comment.style)})</b>\n${escapeHtml(comment.body)}` : '',
    warnings.length ? `\n⚠️ ${warnings.slice(0, 4).map((w) => escapeHtml(w)).join('\n⚠️ ')}` : '',
  ].filter(Boolean);

  const missingRequirements: string[] = [];
  if (!opportunity.company) missingRequirements.push('company');
  if (!opportunity.category) missingRequirements.push('category');
  if (!opportunity.summary) missingRequirements.push('summary');
  if (!opportunity.application_url && !opportunity.recruitment_email && !opportunity.careers_url) {
    missingRequirements.push('application route');
  }

  const buttons = [
    [
      { text: 'Approve & Publish', callback_data: `pub:${opportunity.id}` },
      { text: 'Save Draft', callback_data: `draft:${opportunity.id}` },
    ],
    [
      { text: 'Reject', callback_data: `rej:${opportunity.id}` },
      { text: 'Regenerate Comment', callback_data: `regen:${opportunity.id}` },
    ],
    [{ text: 'Open Admin Review', url: `${env.siteUrl}/admin/opportunities/${opportunity.id}` }],
  ];

  const footer = missingRequirements.length
    ? `\n\nNeeds ${missingRequirements.join(', ')} before it can publish. Use the admin review page.`
    : '';

  await messenger.sendMessage(chatId, `${lines.join('\n')}${footer}`.slice(0, 4000), {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: buttons },
  });
}

function latestComments<T extends { version: number }>(comments: T[]): T[] {
  const max = comments.reduce((value, c) => Math.max(value, c.version), 0);
  return comments.filter((c) => c.version === max);
}

export { generateComments };
