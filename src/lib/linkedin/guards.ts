import { canonicalLinkedInPostUrl, extractLinkedInPostId, isLinkedInHost } from '../domain/url';
import { retrievalFailure, type RetrievalFailure } from './types';

export const MAX_BODY_BYTES = 2_000_000;
export const MAX_REDIRECTS = 3;
export const DEFAULT_TIMEOUT_MS = 10_000;

const AUTHWALL_PATHS = [
  '/signup',
  '/login',
  '/authwall',
  '/checkpoint',
  '/uas/login',
  '/uas/authenticate',
];

export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

/**
 * Only public LinkedIn post URLs are fetchable. This is not a general fetcher:
 * arbitrary user URLs never reach the network layer.
 */
export function validateRetrievalTarget(
  rawUrl: string,
): { ok: true; url: URL; activityId: string } | { ok: false; failure: RetrievalFailure } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, failure: retrievalFailure('unsupported_url', 'The source URL is invalid.') };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, failure: retrievalFailure('blocked_host', 'Only HTTPS LinkedIn URLs can be retrieved.') };
  }
  if (!isLinkedInHost(url.hostname) || isPrivateHostname(url.hostname)) {
    return { ok: false, failure: retrievalFailure('blocked_host', 'Only LinkedIn hosts are allowed.') };
  }
  if (url.hostname === 'lnkd.in') {
    return {
      ok: false,
      failure: retrievalFailure(
        'unsupported_url',
        'LinkedIn short links must be expanded to the original post URL first.',
      ),
    };
  }
  const activityId = extractLinkedInPostId(url);
  if (!activityId) {
    return {
      ok: false,
      failure: retrievalFailure('unsupported_url', 'Only LinkedIn post/update URLs can be retrieved.'),
    };
  }
  return { ok: true, url: new URL(canonicalLinkedInPostUrl(activityId)), activityId };
}

export function isAuthwallUrl(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  return AUTHWALL_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

export function looksLikeAuthwall(html: string): boolean {
  const head = html.slice(0, 20_000).toLowerCase();
  return (
    head.includes('authwall') ||
    head.includes('/signup/cold-join') ||
    head.includes('sign in to linkedin') ||
    head.includes('linkedin login')
  );
}

export function nextRedirect(
  current: URL,
  response: Response,
): { ok: true; url: URL } | { ok: false; failure: RetrievalFailure } {
  const location = response.headers.get('location');
  if (!location) {
    return { ok: false, failure: retrievalFailure('http_error', 'LinkedIn returned a redirect without a location.', { httpStatus: response.status }) };
  }
  let target: URL;
  try {
    target = new URL(location, current);
  } catch {
    return { ok: false, failure: retrievalFailure('blocked_host', 'LinkedIn returned an invalid redirect.') };
  }
  if (target.protocol !== 'https:' || !isLinkedInHost(target.hostname) || isPrivateHostname(target.hostname)) {
    return { ok: false, failure: retrievalFailure('blocked_host', 'Retrieval was redirected outside LinkedIn and was stopped.') };
  }
  return { ok: true, url: target };
}

/** Reads at most `maxBytes`; rejects instead of silently truncating. */
export async function readCappedBody(response: Response, maxBytes = MAX_BODY_BYTES): Promise<
  { ok: true; text: string } | { ok: false; failure: RetrievalFailure }
> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    return {
      ok: false,
      failure: retrievalFailure('too_large', 'The source page is larger than the retrieval limit.', {
        httpStatus: response.status,
      }),
    };
  }
  if (!response.body) {
    const text = await response.text();
    return text.length > maxBytes
      ? { ok: false, failure: retrievalFailure('too_large', 'The source page is larger than the retrieval limit.') }
      : { ok: true, text };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return {
        ok: false,
        failure: retrievalFailure('too_large', 'The source page is larger than the retrieval limit.', {
          httpStatus: response.status,
        }),
      };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}
