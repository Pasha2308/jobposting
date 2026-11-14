/**
 * Environment access that works in Astro dev (import.meta.env) and on
 * Cloudflare Pages (`Astro.locals.runtime.env`). Secrets are only ever read
 * on the server.
 */

export type RuntimeEnv = Record<string, string | undefined>;

export type AppEnv = {
  siteUrl: string;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseServiceRoleKey: string | null;
  geminiApiKey: string | null;
  geminiModel: string;
  aiProvider: 'gemini' | 'none';
  telegramBotToken: string | null;
  telegramWebhookSecret: string | null;
  telegramAdminIds: number[];
  turnstileSecretKey: string | null;
  turnstileSiteKey: string | null;
  isProduction: boolean;
  isTest: boolean;
};

const DEFAULT_SITE_URL = 'https://hustlercommunity-opportunities.pages.dev';

function importMetaEnv(): RuntimeEnv {
  try {
    return (import.meta as unknown as { env?: RuntimeEnv }).env ?? {};
  } catch {
    return {};
  }
}

function nodeEnv(): RuntimeEnv {
  try {
    if (typeof process !== 'undefined' && process.env) return process.env as RuntimeEnv;
  } catch {
    // Workers has no process.
  }
  return {};
}

/**
 * Merge sources in priority order: Cloudflare runtime bindings, Vite env,
 * then process.env (Node dev / tests).
 */
export function resolveEnv(runtime?: RuntimeEnv | null): AppEnv {
  const vite = importMetaEnv();
  const node = nodeEnv();
  const read = (key: string): string | undefined => {
    const value = runtime?.[key] ?? vite[key] ?? node[key];
    return value == null || value === '' ? undefined : String(value);
  };

  const siteUrl = (read('PUBLIC_SITE_URL') || read('SITE_URL') || DEFAULT_SITE_URL).replace(/\/+$/, '');
  const adminIds = (read('TELEGRAM_ADMIN_USER_IDS') || '')
    .split(/[,\s]+/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

  const aiProviderValue = (read('AI_PROVIDER') || 'gemini').toLowerCase();

  return {
    siteUrl,
    supabaseUrl: read('SUPABASE_URL') ?? null,
    supabaseAnonKey: read('SUPABASE_ANON_KEY') ?? null,
    supabaseServiceRoleKey: read('SUPABASE_SERVICE_ROLE_KEY') ?? null,
    geminiApiKey: read('GEMINI_API_KEY') ?? null,
    geminiModel: read('GEMINI_MODEL') || 'gemini-2.5-flash',
    aiProvider: aiProviderValue === 'none' ? 'none' : 'gemini',
    telegramBotToken: read('TELEGRAM_BOT_TOKEN') ?? null,
    telegramWebhookSecret: read('TELEGRAM_WEBHOOK_SECRET') ?? null,
    telegramAdminIds: adminIds,
    turnstileSecretKey: read('TURNSTILE_SECRET_KEY') ?? null,
    turnstileSiteKey: read('PUBLIC_TURNSTILE_SITE_KEY') ?? null,
    isProduction: read('NODE_ENV') === 'production' || read('CF_PAGES') === '1',
    isTest: read('NODE_ENV') === 'test' || read('VITEST') === 'true',
  };
}

export function isDatabaseConfigured(env: AppEnv): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}

export function isAiConfigured(env: AppEnv): boolean {
  return env.aiProvider === 'gemini' && Boolean(env.geminiApiKey);
}

export function isTelegramConfigured(env: AppEnv): boolean {
  return Boolean(env.telegramBotToken && env.telegramWebhookSecret && env.telegramAdminIds.length);
}

export function configurationReport(env: AppEnv) {
  return {
    database: isDatabaseConfigured(env),
    ai: isAiConfigured(env),
    telegram: isTelegramConfigured(env),
    turnstile: Boolean(env.turnstileSecretKey && env.turnstileSiteKey),
    siteUrl: env.siteUrl,
  };
}
