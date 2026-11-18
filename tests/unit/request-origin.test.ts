import { describe, expect, it } from 'vitest';
import { allowedRequestOrigins, assertSameOrigin, isSecureRequest } from '../../src/lib/http';
import { resolveEnv } from '../../src/lib/env';
import { ServiceError } from '../../src/lib/services/errors';

const prodEnv = resolveEnv({
  NODE_ENV: 'production',
  PUBLIC_SITE_URL: 'https://jobposting-nine.vercel.app',
});

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: 'POST', headers });
}

describe('same-origin enforcement behind a TLS-terminating proxy', () => {
  it('accepts the production origin when the proxy reconstructed an http URL', () => {
    const req = request('http://jobposting-nine.vercel.app/api/admin/login', {
      origin: 'https://jobposting-nine.vercel.app',
      'x-forwarded-host': 'jobposting-nine.vercel.app',
      'x-forwarded-proto': 'https',
    });
    expect(() => assertSameOrigin(req, prodEnv)).not.toThrow();
  });

  it('accepts the host header origin when no forwarded proto is present', () => {
    const req = request('http://jobposting-nine.vercel.app/api/admin/login', {
      origin: 'https://jobposting-nine.vercel.app',
      host: 'jobposting-nine.vercel.app',
    });
    expect(() => assertSameOrigin(req, prodEnv)).not.toThrow();
  });

  it('accepts the configured public site origin on an alias host', () => {
    const req = request('http://internal.vercel.app/api/admin/login', {
      origin: 'https://jobposting-nine.vercel.app',
    });
    expect(() => assertSameOrigin(req, prodEnv)).not.toThrow();
  });

  it('includes both configured and forwarded origins in the allow list', () => {
    const req = request('https://deploy-abc.vercel.app/x', {
      origin: 'https://jobposting-nine.vercel.app',
      'x-forwarded-host': 'deploy-abc.vercel.app',
      'x-forwarded-proto': 'https',
    });
    const origins = [...allowedRequestOrigins(req, prodEnv)];
    expect(origins).toContain('https://jobposting-nine.vercel.app');
    expect(origins).toContain('https://deploy-abc.vercel.app');
  });

  it('rejects a cross-site origin', () => {
    const req = request('https://jobposting-nine.vercel.app/api/admin/login', {
      origin: 'https://evil.example',
    });
    try {
      assertSameOrigin(req, prodEnv);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).code).toBe('forbidden_origin');
      expect((error as ServiceError).status).toBe(403);
    }
  });

  it('rejects an opaque null origin', () => {
    const req = request('https://jobposting-nine.vercel.app/api/admin/login', { origin: 'null' });
    expect(() => assertSameOrigin(req, prodEnv)).toThrow(ServiceError);
  });

  it('rejects a cross-site browser request with no origin header', () => {
    const req = request('https://jobposting-nine.vercel.app/api/admin/login', {
      'sec-fetch-site': 'cross-site',
    });
    expect(() => assertSameOrigin(req, prodEnv)).toThrow(ServiceError);
  });

  it('allows same-origin requests that omit an origin header', () => {
    const req = request('https://jobposting-nine.vercel.app/api/admin/login', {
      'sec-fetch-site': 'same-origin',
    });
    expect(() => assertSameOrigin(req, prodEnv)).not.toThrow();
  });

  it('rejects requests that omit both origin and same-origin fetch metadata', () => {
    const req = request('http://localhost:4321/api/admin/login');
    expect(() => assertSameOrigin(req, prodEnv)).toThrow(ServiceError);
  });
});

describe('secure cookie detection behind a proxy', () => {
  it('treats a forwarded https request as secure even when the internal URL is http', () => {
    const req = request('http://internal:3000/api/admin/login', { 'x-forwarded-proto': 'https' });
    expect(isSecureRequest(req)).toBe(true);
  });

  it('treats a forwarded http request as insecure', () => {
    const req = request('https://jobposting-nine.vercel.app/api/admin/login', { 'x-forwarded-proto': 'http' });
    expect(isSecureRequest(req)).toBe(false);
  });

  it('falls back to the request URL scheme when no proxy header is present', () => {
    expect(isSecureRequest(request('https://jobposting-nine.vercel.app/x'))).toBe(true);
    expect(isSecureRequest(request('http://localhost:4321/x'))).toBe(false);
  });
});
