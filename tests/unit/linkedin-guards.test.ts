import { describe, expect, it } from 'vitest';
import {
  isAuthwallUrl,
  isPrivateHostname,
  looksLikeAuthwall,
  nextRedirect,
  readCappedBody,
  validateRetrievalTarget,
} from '../../src/lib/linkedin/guards';
import { createJsonLdAdapter } from '../../src/lib/linkedin/jsonld';

const SITE = 'https://opportunities.test';
const POST_URL = 'https://www.linkedin.com/posts/acme_founder-associate-1234567890';

const HTML = `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify({
  '@type': 'SocialMediaPosting',
  author: { name: 'Acme Founder' },
  datePublished: '2026-02-01T09:30:00.000Z',
  articleBody: 'Hiring a Founder Associate. Apply: https://acme.test/apply/fa',
})}</script>
</head><body></body></html>`;

describe('validateRetrievalTarget', () => {
  it('accepts a LinkedIn post URL and normalises it to the activity URN', () => {
    const result = validateRetrievalTarget(POST_URL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.activityId).toBe('1234567890');
      expect(result.url.toString()).toBe(
        'https://www.linkedin.com/feed/update/urn:li:activity:1234567890',
      );
    }
  });

  it('rejects non-LinkedIn, insecure, short and non-post URLs', () => {
    for (const url of [
      'https://example.com/posts/acme_role-1234567890',
      'http://www.linkedin.com/posts/acme_role-1234567890',
      'https://lnkd.in/abc123',
      'https://www.linkedin.com/company/acme',
      'not-a-url',
    ]) {
      const result = validateRetrievalTarget(url);
      expect(result.ok, url).toBe(false);
    }
  });

  it('rejects internal hosts even when the suffix looks like LinkedIn', () => {
    expect(validateRetrievalTarget('https://127.0.0.1/posts/1234567890').ok).toBe(false);
    expect(validateRetrievalTarget('https://localhost/posts/1234567890').ok).toBe(false);
  });
});

describe('isPrivateHostname', () => {
  it('flags loopback, link-local and RFC1918 addresses', () => {
    for (const host of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.5.5', 'localhost', '::1']) {
      expect(isPrivateHostname(host), host).toBe(true);
    }
    for (const host of ['www.linkedin.com', '8.8.8.8', '172.32.0.1']) {
      expect(isPrivateHostname(host), host).toBe(false);
    }
  });
});

describe('redirect guard', () => {
  it('allows LinkedIn redirects and blocks external ones', () => {
    const current = new URL('https://www.linkedin.com/feed/update/urn:li:activity:1234567890');

    const allowed = nextRedirect(
      current,
      new Response(null, { status: 302, headers: { location: 'https://www.linkedin.com/posts/x' } }),
    );
    expect(allowed.ok).toBe(true);

    const blocked = nextRedirect(
      current,
      new Response(null, { status: 302, headers: { location: 'https://evil.test/steal' } }),
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.failure.errorCode).toBe('blocked_host');
  });

  it('recognises authwall URLs and pages', () => {
    expect(isAuthwallUrl(new URL('https://www.linkedin.com/authwall?trk=x'))).toBe(true);
    expect(isAuthwallUrl(new URL('https://www.linkedin.com/feed/update/urn:li:activity:1'))).toBe(false);
    expect(looksLikeAuthwall('<html><title>Sign in to LinkedIn</title></html>')).toBe(true);
    expect(looksLikeAuthwall(HTML)).toBe(false);
  });
});

describe('readCappedBody', () => {
  it('rejects a declared body larger than the cap', async () => {
    const response = new Response('x', { headers: { 'content-length': '999999999' } });
    const result = await readCappedBody(response, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.errorCode).toBe('too_large');
  });

  it('rejects a streamed body that exceeds the cap', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('a'.repeat(8)));
        controller.enqueue(new TextEncoder().encode('b'.repeat(8)));
        controller.close();
      },
    });
    const result = await readCappedBody(new Response(stream), 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.errorCode).toBe('too_large');
  });

  it('returns the body when within the cap', async () => {
    const result = await readCappedBody(new Response('hello'), 10);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('hello');
  });
});

describe('createJsonLdAdapter', () => {
  it('retrieves and parses a public post', async () => {
    const calls: string[] = [];
    const adapter = createJsonLdAdapter({
      siteUrl: SITE,
      fetchImpl: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } });
      }) as typeof fetch,
    });

    const result = await adapter(POST_URL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.method).toBe('jsonld');
      expect(result.post.author).toBe('Acme Founder');
      expect(result.post.text).toContain('Founder Associate');
      expect(calls[0]).toBe('https://www.linkedin.com/feed/update/urn:li:activity:1234567890');
    }
  });

  it('classifies authwall redirects as login_required and stops', async () => {
    const adapter = createJsonLdAdapter({
      siteUrl: SITE,
      fetchImpl: (async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://www.linkedin.com/authwall?trk=abc' },
        })) as typeof fetch,
    });

    const result = await adapter(POST_URL);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('login_required');
      expect(result.retryable).toBe(false);
    }
  });

  it('blocks redirects that leave LinkedIn', async () => {
    const adapter = createJsonLdAdapter({
      siteUrl: SITE,
      fetchImpl: (async () =>
        new Response(null, { status: 301, headers: { location: 'https://evil.test/post' } })) as typeof fetch,
    });
    const result = await adapter(POST_URL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('blocked_host');
  });

  it('classifies 404, rate limits and non-HTML responses', async () => {
    const make = (response: () => Response) =>
      createJsonLdAdapter({ siteUrl: SITE, fetchImpl: (async () => response()) as typeof fetch });

    const notFound = await make(() => new Response('missing', { status: 404 }))(POST_URL);
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) expect(notFound.errorCode).toBe('not_found');

    const limited = await make(() => new Response('slow down', { status: 429 }))(POST_URL);
    expect(limited.ok).toBe(false);
    if (!limited.ok) {
      expect(limited.errorCode).toBe('rate_limited');
      expect(limited.retryable).toBe(true);
    }

    const notHtml = await make(
      () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )(POST_URL);
    expect(notHtml.ok).toBe(false);
    if (!notHtml.ok) expect(notHtml.errorCode).toBe('no_content');
  });

  it('returns no_content when the page has no post object', async () => {
    const adapter = createJsonLdAdapter({
      siteUrl: SITE,
      fetchImpl: (async () =>
        new Response('<html><body>Nothing</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })) as typeof fetch,
    });
    const result = await adapter(POST_URL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('no_content');
  });

  it('reports timeouts as retryable', async () => {
    const adapter = createJsonLdAdapter({
      siteUrl: SITE,
      fetchImpl: (async () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }) as typeof fetch,
    });
    const result = await adapter(POST_URL);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('timeout');
      expect(result.retryable).toBe(true);
    }
  });
});
