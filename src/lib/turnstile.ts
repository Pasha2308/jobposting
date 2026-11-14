import type { AppEnv } from './env';

/**
 * Cloudflare Turnstile is optional. When keys are configured, every public
 * write verifies the token server-side. When absent, the honeypot and rate
 * limiter still apply (documented in the README).
 */
export async function verifyTurnstile(
  token: string | undefined,
  secret: string | null,
  remoteIp?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; reason?: string }> {
  if (!secret) return { ok: true };
  if (!token) return { ok: false, reason: 'Missing Turnstile token.' };

  const form = new URLSearchParams();
  form.set('secret', secret);
  form.set('response', token);
  if (remoteIp) form.set('remoteip', remoteIp);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return { ok: false, reason: 'Turnstile verification was unavailable.' };
    const result = (await response.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (result.success) return { ok: true };
    return { ok: false, reason: 'Turnstile verification failed.' };
  } catch {
    return { ok: false, reason: 'Turnstile verification timed out.' };
  }
}

export function turnstileEnabled(env: AppEnv): boolean {
  return Boolean(env.turnstileSiteKey && env.turnstileSecretKey);
}
