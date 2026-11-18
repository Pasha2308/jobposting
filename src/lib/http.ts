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
 * Origins a state-changing request may legitimately come from.
 *
 * Astro's built-in `security.checkOrigin` compares the browser `Origin` header
 * with the URL Astro reconstructed. Behind a TLS-terminating proxy (Vercel,
 * Cloudflare, a load balancer) that reconstructed URL can be `http://…` while
 * the browser correctly sends `https://…`, which rejects valid admin logins
 * with "Cross-site POST form submissions are forbidden". This helper accepts
 * the configured public origin and the deployment's own forwarded host, and
 * nothing else — so it stays a real same-origin check while tolerating proxies.
 */
export function allowedRequestOrigins(request: Request, env: AppEnv): Set<string> {
  const allowed = new Set<string>();
  const add = (value: string | null | undefined): void => {
    if (!value) return;
    try {
      allowed.add(new URL(value).origin);
    } catch {
      // Ignore malformed values; they simply are not allowed.
    }
  };

  add(request.url);
  add(env.siteUrl);

  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = (forwardedHost ?? request.headers.get('host') ?? '').split(',')[0]?.trim();
  if (host) {
    const forwardedProto = (request.headers.get('x-forwarded-proto') ?? '').split(',')[0]?.trim().toLowerCase();
    let proto = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : '';
    if (!proto) {
      try {
        proto = new URL(request.url).protocol.replace(':', '');
      } catch {
        proto = '';
      }
    }
    if (proto) add(`${proto}://${host}`);
    // Proxies terminate TLS and may pass an internal http hop; the public origin
    // for this same host is still https in production.
    if (env.isProduction) add(`https://${host}`);
  }

  return allowed;
}

/**
 * True when the browser's connection to the deployment is HTTPS, accounting for
 * a TLS-terminating proxy that reports the original scheme in
 * `x-forwarded-proto`. Used to decide the `Secure` cookie flag.
 */
export function isSecureRequest(request: Request): boolean {
  const forwarded = (request.headers.get('x-forwarded-proto') ?? '').split(',')[0]?.trim().toLowerCase();
  if (forwarded === 'https') return true;
  if (forwarded === 'http') return false;
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Same-origin enforcement for state-changing requests. This complements
 * SameSite=Lax cookies and protects against cross-site form posts. It runs in
 * every mutating route because the built-in Astro check is disabled: it cannot
 * account for a TLS-terminating proxy and blocked production logins.
 */
export function assertSameOrigin(request: Request, env: AppEnv): void {
  const origin = request.headers.get('origin');
  if (origin) {
    const allowed = allowedRequestOrigins(request, env);
    let normalized = origin.trim();
    try {
      normalized = new URL(normalized).origin;
    } catch {
      // Keep the raw value; it will not match.
    }
    if (!allowed.has(normalized)) {
      throw new ServiceError('forbidden_origin', 'Cross-origin request blocked.', 403);
    }
    return;
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== 'same-origin') {
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
