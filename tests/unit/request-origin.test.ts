import { describe, expect, it } from 'vitest';
import { allowedRequestOrigins, assertSameOrigin, isSecureRequest } from '../../src/lib/http';
import { resolveEnv } from '../../src/lib/env';
import { ServiceError } from '../../src/lib/services/errors';
import astroConfig from '../../astro.config.mjs';
import { NodeApp } from 'astro/app/node';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const astroSecurity = astroConfig.security;
const astroSite = astroConfig.site;
if (!astroSecurity || !astroSite) throw new Error('Astro security config and site URL must be defined.');

const prodEnv = resolveEnv({
  NODE_ENV: 'production',
  PUBLIC_SITE_URL: 'https://jobposting-nine.vercel.app',
});

describe('Astro proxy and CSRF configuration', () => {
  it('keeps Astro built-in origin checking enabled', () => {
    expect(astroSecurity.checkOrigin).toBe(true);
  });

  it('allows the configured site domain without a wildcard host pattern', () => {
    const site = new URL(astroSite);
    expect(astroSecurity.allowedDomains).toContainEqual({
      hostname: site.hostname,
      ...(site.port ? { port: site.port } : {}),
    });
    expect(astroSecurity.allowedDomains).not.toContainEqual({ hostname: '**.vercel.app' });
  });

  it('lets Astro trust forwarded protocol and host data for configured domains only', () => {
    const site = new URL(astroSite);
    const protocol = site.protocol.slice(0, -1);
    const allowed = NodeApp.validateForwardedHeaders(
      protocol,
      site.hostname,
      undefined,
      astroSecurity.allowedDomains,
    );
    const rejected = NodeApp.validateForwardedHeaders(
      protocol,
      'attacker.example',
      undefined,
      astroSecurity.allowedDomains,
    );

    expect(allowed).toEqual({ protocol, host: site.hostname });
    expect(rejected).toEqual({ protocol });
  });

  it('guards every browser mutation route and authenticates service mutations separately', () => {
    const apiRoot = join(process.cwd(), 'src/pages/api');
    const routeFiles = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return routeFiles(path);
        return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
      });
    const mutationPattern = /export const (?:POST|PUT|PATCH|DELETE)\b|export const POST\s*=/;
    const mutations = routeFiles(apiRoot)
      .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
      .filter(({ source }) => mutationPattern.test(source));

    expect(mutations.length).toBeGreaterThan(10);
    for (const { path, source } of mutations) {
      const route = relative(apiRoot, path).replaceAll('\\', '/');
      if (route === 'telegram/webhook.ts') {
        expect(source).toContain('x-telegram-bot-api-secret-token');
        expect(source).toContain('safeEqual(secret, env.telegramWebhookSecret)');
      } else if (route === 'telegram/portfolio-webhook.ts') {
        expect(source).toContain('x-telegram-bot-api-secret-token');
        expect(source).toContain('safeEqual(suppliedSecret, env.portfolioTelegramWebhookSecret)');
      } else if (route === 'cron/retry-retrievals.ts') {
        expect(source).toContain("header === `Bearer ${secret}`");
        expect(source).toContain('if (!authorised(request, env.cronSecret))');
      } else {
        expect(source, route).toContain('assertSameOrigin(');
      }
    }
  });

  it('configures Astro Vercel function time for the portfolio bot and keeps the intake webhook separate', () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
      functions?: Record<string, { maxDuration?: number }>;
    };
    const astroConfigSource = readFileSync(join(process.cwd(), 'astro.config.mjs'), 'utf8');
    expect(astroConfigSource).toContain('adapter: vercel({ maxDuration: 60 })');
    expect(vercel.functions).toBeUndefined();
  });
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

  it('accepts the configured production origin without trusting Host headers', () => {
    const req = request('http://jobposting-nine.vercel.app/api/admin/login', {
      origin: 'https://jobposting-nine.vercel.app',
      host: 'attacker.example',
    });
    expect(() => assertSameOrigin(req, prodEnv)).not.toThrow();
  });

  it('accepts the configured public site origin on an alias host', () => {
    const req = request('http://internal.vercel.app/api/admin/login', {
      origin: 'https://jobposting-nine.vercel.app',
    });
    expect(() => assertSameOrigin(req, prodEnv)).not.toThrow();
  });

  it('includes the configured origin and secure request origin only', () => {
    const req = request('https://deploy-abc.vercel.app/x', {
      origin: 'https://jobposting-nine.vercel.app',
      'x-forwarded-host': 'deploy-abc.vercel.app',
      'x-forwarded-proto': 'https',
    });
    const origins = [...allowedRequestOrigins(req, prodEnv)];
    expect(origins).toContain('https://jobposting-nine.vercel.app');
    expect(origins).toContain('https://deploy-abc.vercel.app');
  });

  it('does not allow an HTTP origin merely because it shares the production host', () => {
    const req = request('http://jobposting-nine.vercel.app/api/admin/login', {
      origin: 'http://jobposting-nine.vercel.app',
      host: 'jobposting-nine.vercel.app',
      'x-forwarded-host': 'jobposting-nine.vercel.app',
      'x-forwarded-proto': 'http',
    });
    expect(() => assertSameOrigin(req, prodEnv)).toThrow(ServiceError);
  });

  it('does not allow an origin introduced only by forwarded headers', () => {
    const req = request('http://internal.vercel.app/api/admin/login', {
      origin: 'https://attacker.example',
      'x-forwarded-host': 'attacker.example',
      'x-forwarded-proto': 'https',
    });
    expect(() => assertSameOrigin(req, prodEnv)).toThrow(ServiceError);
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
