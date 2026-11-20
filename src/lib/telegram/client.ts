/**
 * Minimal Telegram Bot API client (fetch-based, Workers-compatible). No SDK is
 * required and the token never leaves the server.
 */
export type TelegramButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

export type SendOptions = {
  parse_mode?: 'HTML';
  disable_web_page_preview?: boolean;
  reply_markup?: { inline_keyboard: TelegramButton[][] };
};

export interface Messenger {
  sendMessage(chatId: number, text: string, options?: SendOptions): Promise<{ message_id: number }>;
  editMessageText(chatId: number, messageId: number, text: string, options?: SendOptions): Promise<void>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
}

export class TelegramError extends Error {
  status: number;
  retryAfter: number | null;
  constructor(message: string, status = 500, retryAfter: number | null = null) {
    super(message);
    this.name = 'TelegramError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export class TelegramClient implements Messenger {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch {
      throw new TelegramError('Telegram is unreachable. Try again shortly.', 502);
    } finally {
      clearTimeout(timer);
    }
    const data = (await response.json().catch(() => null)) as
      | { ok?: boolean; result?: T; description?: string; parameters?: { retry_after?: number } }
      | null;
    if (!response.ok || !data?.ok) {
      throw new TelegramError(`Telegram API error: ${data?.description ?? response.status}`, response.status, data?.parameters?.retry_after ?? null);
    }
    return data.result as T;
  }

  async sendMessage(chatId: number, text: string, options: SendOptions = {}): Promise<{ message_id: number }> {
    return this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text: text.slice(0, 4000),
      ...options,
    });
  }

  async editMessageText(chatId: number, messageId: number, text: string, options: SendOptions = {}): Promise<void> {
    await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: text.slice(0, 4000),
      ...options,
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
