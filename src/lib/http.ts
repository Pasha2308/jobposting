import { AIError } from './ai/provider';
import { DatabaseUnavailableError } from './supabase';
import { StoreError } from './store/supabase-store';
import { ServiceError } from './services/errors';
import type { AppEnv } from './env';

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function apiError(error: unknown): Response {
  if (error instanceof ServiceError) {
    return jsonResponse({ error: error.message, code: error.code, ...error.details }, error.status);
  }
  if (error instanceof DatabaseUnavailableError) {
    return jsonResponse({ error: error.message, code: 'database_unavailable' }, 503);
  }
  if (error instanceof AIError) {
    return jsonResponse({ error: error.message, code: `ai_${error.kind}`, retryable: error.retryable }, 502);
  }
  if (error instanceof StoreError) {
    console.error('database error', error.code ?? '', error.message);
    return jsonResponse({ error: 'A database error occurred. Please try again.', code: 'database_error' }, 500);
  }
  console.error('unhandled api error', error instanceof Error ? error.message : error);
  return jsonResponse({ error: 'Something went wrong. Please try again.', code: 'server_error' }, 500);
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) return await request.json();
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  } catch {
    throw new ServiceError('invalid_json', 'The request body could not be read.', 400);
  }
}

export function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

export function formBool(form: FormData, key: string): boolean {
  const value = form.get(key);
  return value === 'on' || value === 'true' || value === '1';
}

/**
 * Same-origin enforcement for state-changing admin requests. This complements
 * SameSite=Lax cookies and protects against cross-site form posts.
 */
export function assertSameOrigin(request: Request, env: AppEnv): void {
  const origin = request.headers.get('origin');
  const allowed = new Set<string>([new URL(request.url).origin, new URL(env.siteUrl).origin]);
  if (origin) {
    if (!allowed.has(origin)) {
      throw new ServiceError('forbidden_origin', 'Cross-origin request blocked.', 403);
    }
    return;
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new ServiceError('forbidden_origin', 'Cross-origin request blocked.', 403);
  }
}

export function requireMethod(request: Request, method: 'POST' | 'GET'): void {
  if (request.method !== method) {
    throw new ServiceError('method_not_allowed', 'Method not allowed.', 405);
  }
}

/** Only allow internal paths as post-login redirect targets. */
export function safeNextPath(value: string | null | undefined, fallback = '/admin'): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  if (!value.startsWith('/admin')) return fallback;
  return value;
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export const NO_STORE = { 'cache-control': 'no-store' } as const;
