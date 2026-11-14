/**
 * Small in-isolate rate limiter for public write endpoints. Cloudflare may run
 * several isolates, so this is defence in depth rather than a hard quota. No
 * IP is ever persisted; the key lives in memory only and expires with the
 * window. For stricter limits, attach Cloudflare Turnstile (supported).
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

export function clientKey(request: Request, suffix: string): string {
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  return `${suffix}:${ip}`;
}

/** Medium-term cleanup so the map cannot grow unbounded on a long-lived isolate. */
export function pruneRateLimits(now = Date.now()): void {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}
