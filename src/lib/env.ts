/**
 * Environment access that works in Astro dev, Vercel serverless functions and
 * Node tests. Secrets are only ever read on the server.
 */

export type RuntimeEnv = Record<string, string | undefined>;

export type AppEnv = {
  siteUrl: string;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseServiceRoleKey: string | null;
  geminiApiKey: string | null;
  geminiModel: string;
  aiProvider: 'none' | 'gemini' | 'groq';
  groqApiKey: string | null;
  groqModel: string;
  telegramBotToken: string | null;
  telegramWebhookSecret: string | null;
  telegramAdminIds: number[];
  turnstileSecretKey: string | null;
  turnstileSiteKey: string | null;
  /** Enables the isolated public JSON-LD adapter. Off unless both flags are on. */
  linkedinJsonLdEnabled: boolean;
  /** Confirms legal/contractual authorisation to retrieve LinkedIn pages. */
  linkedinRetrievalAuthorised: boolean;
  /** Bearer secret for the recovery cron endpoints. */
  cronSecret: string | null;
  isProduction: boolean;
  isTest: boolean;
};

const DEFAULT_SITE_URL = 'https://hustlercommunity-opportunities.vercel.app';

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
 * Merge sources in priority order: hosting runtime bindings, Vite env, then
 * process.env (Node dev / tests).
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

  const aiProviderValue: 'none' | 'gemini' | 'groq' = (read('AI_PROVIDER') || 'groq').toLowerCase() as 'none' | 'gemini' | 'groq';

  const truthy = (value: string | undefined): boolean =>
    value === '1' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'yes';

  const rawSupabaseUrl = read('SUPABASE_URL');
  const supabaseUrl = rawSupabaseUrl
    ? rawSupabaseUrl.startsWith('http://') || rawSupabaseUrl.startsWith('https://')
      ? rawSupabaseUrl
      : `https://${rawSupabaseUrl}.supabase.co`
    : null;

  return {
    siteUrl,
    supabaseUrl,
    supabaseAnonKey: read('SUPABASE_ANON_KEY') ?? null,
    supabaseServiceRoleKey: read('SUPABASE_SERVICE_ROLE_KEY') ?? null,
    geminiApiKey: read('GEMINI_API_KEY') ?? null,
    geminiModel: read('GEMINI_MODEL') || 'gemini-2.5-flash',
    aiProvider: aiProviderValue === 'none' ? 'none' : aiProviderValue,
    groqApiKey: read('GROQ_API_KEY') ?? null,
    groqModel: read('GROQ_MODEL') || 'openai/gpt-oss-120b',
    telegramBotToken: read('TELEGRAM_BOT_TOKEN') ?? null,
    telegramWebhookSecret: read('TELEGRAM_WEBHOOK_SECRET') ?? null,
    telegramAdminIds: adminIds,
    turnstileSecretKey: read('TURNSTILE_SECRET_KEY') ?? null,
    turnstileSiteKey: read('PUBLIC_TURNSTILE_SITE_KEY') ?? null,
    linkedinJsonLdEnabled: truthy(read('LINKEDIN_JSONLD_RETRIEVAL_ENABLED')),
    linkedinRetrievalAuthorised: truthy(read('LINKEDIN_RETRIEVAL_AUTHORISED')),
    cronSecret: read('CRON_SECRET') ?? null,
    isProduction:
      read('NODE_ENV') === 'production' ||
      read('VERCEL_ENV') === 'production' ||
      read('VERCEL') === '1',
    isTest: read('NODE_ENV') === 'test' || read('VITEST') === 'true',
  };
}

export function isDatabaseConfigured(env: AppEnv): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}

export function isAiConfigured(env: AppEnv): boolean {
  if (env.aiProvider === 'gemini') return Boolean(env.geminiApiKey);
  if (env.aiProvider === 'groq') return Boolean(env.groqApiKey);
  return false;
}

export function isTelegramConfigured(env: AppEnv): boolean {
  return Boolean(env.telegramBotToken && env.telegramWebhookSecret && env.telegramAdminIds.length);
}

/**
 * Direct LinkedIn retrieval is only permitted when both the adapter is switched
 * on AND authorisation has been recorded. Either flag missing keeps it off.
 */
export function isLinkedInRetrievalEnabled(env: AppEnv): boolean {
  return env.linkedinJsonLdEnabled && env.linkedinRetrievalAuthorised;
}

export function configurationReport(env: AppEnv) {
  return {
    database: isDatabaseConfigured(env),
    auth: Boolean(env.supabaseUrl && env.supabaseAnonKey),
    ai: isAiConfigured(env),
    telegram: isTelegramConfigured(env),
    turnstile: Boolean(env.turnstileSecretKey && env.turnstileSiteKey),
    linkedinRetrieval: isLinkedInRetrievalEnabled(env) ? 'jsonld' : 'disabled',
    siteUrl: env.siteUrl,
  };
}
