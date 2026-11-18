import type { AppEnv } from '../env';
import { isLinkedInRetrievalEnabled } from '../env';
import { canonicalLinkedInPostUrl, extractLinkedInPostId, isLinkedInShortPostUrl } from '../domain/url';
import {
  DEFAULT_TIMEOUT_MS,
  MAX_REDIRECTS,
  isAuthwallUrl,
  looksLikeAuthwall,
  nextRedirect,
  readCappedBody,
  validateRetrievalTarget,
} from './guards';
import { parseLinkedInHtml } from './parse';
import { retrievalFailure, type RetrievalFn, type RetrievalResult } from './types';

type JsonLdOptions = {
  siteUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function userAgent(siteUrl: string): string {
  const origin = siteUrl.replace(/\/+$/, '');
  return `HustlerCommunityBot/1.0 (+${origin}/bot)`;
}

function classifyStatus(status: number): RetrievalResult | null {
  if (status === 404 || status === 410) {
    return retrievalFailure('not_found', 'LinkedIn reports that this post does not exist or was deleted.', {
      method: 'jsonld',
      httpStatus: status,
    });
  }
  if (status === 429 || status === 999) {
    return retrievalFailure('rate_limited', 'LinkedIn rate-limited the retrieval. It will be retried later.', {
      method: 'jsonld',
      httpStatus: status,
      retryable: true,
    });
  }
  if (status >= 500) {
    return retrievalFailure('http_error', `LinkedIn returned a server error (${status}).`, {
      method: 'jsonld',
      httpStatus: status,
      retryable: true,
    });
  }
  return null;
}

/**
 * Unauthenticated public JSON-LD adapter. Disabled unless both
 * LINKEDIN_JSONLD_RETRIEVAL_ENABLED and LINKEDIN_RETRIEVAL_AUTHORISED are true.
 *
 * It sends no cookies, does not rotate proxies, does not spoof a browser, and
 * stops on authwalls/rate limits instead of attempting to bypass them.
 */
export function createJsonLdAdapter(opts: JsonLdOptions): RetrievalFn {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (rawUrl: string): Promise<RetrievalResult> => {
    let resolvedUrl = rawUrl;
    if (isLinkedInShortPostUrl(rawUrl)) {
      const resolved = await resolveShortPostUrl(rawUrl, fetchImpl, timeoutMs, opts.siteUrl);
      if (!resolved.ok) return resolved.failure;
      resolvedUrl = resolved.url;
    }
    const target = validateRetrievalTarget(resolvedUrl);
    if (!target.ok) return target.failure;

    let current = target.url;
    const deadline = Date.now() + timeoutMs;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return retrievalFailure('timeout', 'LinkedIn did not respond before the retrieval deadline.', {
          method: 'jsonld',
          retryable: true,
        });
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remaining);
      let response: Response;
      try {
        response = await fetchImpl(current.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            accept: 'text/html,application/xhtml+xml',
            'accept-language': 'en-US,en;q=0.9',
            'user-agent': userAgent(opts.siteUrl),
            'cache-control': 'no-cache',
          },
        });
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError';
        return retrievalFailure(
          aborted ? 'timeout' : 'network_error',
          aborted ? 'LinkedIn did not respond before the retrieval deadline.' : 'Could not reach LinkedIn.',
          { method: 'jsonld', retryable: true },
        );
      } finally {
        clearTimeout(timer);
      }

      if (response.status >= 300 && response.status < 400) {
        const redirect = nextRedirect(current, response);
        if (!redirect.ok) return redirect.failure;
        if (isAuthwallUrl(redirect.url)) {
          return retrievalFailure(
            'login_required',
            'This post is not publicly accessible: LinkedIn requires sign-in. The URL was preserved.',
            { method: 'jsonld', httpStatus: response.status },
          );
        }
        current = redirect.url;
        continue;
      }

      const classified = classifyStatus(response.status);
      if (classified) return classified;
      if (!response.ok) {
        return retrievalFailure('http_error', `LinkedIn returned HTTP ${response.status}.`, {
          method: 'jsonld',
          httpStatus: response.status,
          retryable: response.status === 408 || response.status === 425,
        });
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        return retrievalFailure('no_content', 'LinkedIn returned a non-HTML response instead of a post.', {
          method: 'jsonld',
          httpStatus: response.status,
        });
      }

      const body = await readCappedBody(response);
      if (!body.ok) return body.failure;
      if (looksLikeAuthwall(body.text)) {
        return retrievalFailure(
          'login_required',
          'This post is not publicly accessible: LinkedIn requires sign-in. The URL was preserved.',
          { method: 'jsonld', httpStatus: response.status },
        );
      }

      const activityId = extractLinkedInPostId(current) ?? target.activityId;
      const canonicalUrl = canonicalLinkedInPostUrl(activityId);
      const post = parseLinkedInHtml(body.text, canonicalUrl, activityId);
      if (!post) {
        return retrievalFailure(
          'no_content',
          'The page was retrieved but contained no public post text. It may be an image-only or restricted post.',
          { method: 'jsonld', httpStatus: response.status },
        );
      }

      return { ok: true, method: 'jsonld', httpStatus: response.status, post };
    }

    return retrievalFailure('blocked_host', 'Too many redirects while retrieving the LinkedIn post.', {
      method: 'jsonld',
    });
  };
}

/** Resolve only the official lnkd.in /p/ share path, following HTTPS redirects
 * on LinkedIn hosts. The response body is never read; post retrieval remains
 * subject to the existing authorization gate and target validation. */
async function resolveShortPostUrl(
  rawUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  siteUrl: string,
): Promise<{ ok: true; url: string } | { ok: false; failure: ReturnType<typeof retrievalFailure> }> {
  let current = new URL(rawUrl);
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, failure: retrievalFailure('timeout', 'LinkedIn share link resolution timed out.', { method: 'jsonld', retryable: true }) };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': userAgent(siteUrl) },
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      return { ok: false, failure: retrievalFailure(aborted ? 'timeout' : 'network_error', 'Could not resolve the LinkedIn share link.', { method: 'jsonld', retryable: true }) };
    } finally { clearTimeout(timer); }

    if (response.status < 300 || response.status >= 400) {
      return { ok: false, failure: retrievalFailure('unsupported_url', 'The LinkedIn share link did not redirect to a post URL.') };
    }
    const redirect = nextRedirect(current, response);
    if (!redirect.ok) return { ok: false, failure: redirect.failure };
    const target = redirect.url;
    const targetHost = target.hostname.toLowerCase();
    if (targetHost === 'lnkd.in') {
      if (!isLinkedInShortPostUrl(target.toString())) return { ok: false, failure: retrievalFailure('blocked_host', 'LinkedIn returned an unsupported short-link path.') };
      current = target;
      continue;
    }
    if (!['linkedin.com', 'www.linkedin.com', 'm.linkedin.com'].includes(targetHost)) {
      return { ok: false, failure: retrievalFailure('blocked_host', 'LinkedIn share link redirected outside LinkedIn.') };
    }
    const activityId = extractLinkedInPostId(target);
    if (!activityId) return { ok: false, failure: retrievalFailure('unsupported_url', 'The LinkedIn share link did not resolve to a specific post.') };
    return { ok: true, url: canonicalLinkedInPostUrl(activityId) };
  }
  return { ok: false, failure: retrievalFailure('blocked_host', 'Too many redirects while resolving the LinkedIn share link.') };
}

/** Resolves the configured adapter. Disabled is the safe, default state. */
export function createRetrievalService(env: Pick<AppEnv, 'siteUrl' | 'linkedinJsonLdEnabled' | 'linkedinRetrievalAuthorised'>): RetrievalFn {
  if (!isLinkedInRetrievalEnabled(env as AppEnv)) {
    return async (rawUrl: string) => {
      const activityId = extractLinkedInPostId(rawUrl);
      if (!activityId && !isLinkedInShortPostUrl(rawUrl)) {
        return retrievalFailure('unsupported_url', 'Only LinkedIn post/update URLs can be ingested.');
      }
      return retrievalFailure(
        'retrieval_not_authorised',
        'Automatic LinkedIn retrieval is disabled until authorised. The capture and original URL are saved; retry after an authorised retrieval method is configured.',
      );
    };
  }
  return createJsonLdAdapter({ siteUrl: env.siteUrl });
}
