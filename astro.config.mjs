// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

const SITE_URL =
  process.env.PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://jobposting-nine.vercel.app');

/** @param {string | undefined} value */
function trustedDomain(value) {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return {
      hostname: url.hostname,
      ...(url.port ? { port: url.port } : {}),
    };
  } catch {
    return null;
  }
}

// Astro validates these exact hosts before trusting Vercel's forwarded
// host/protocol while reconstructing the public request URL.
const ALLOWED_DOMAINS = [
  process.env.PUBLIC_SITE_URL,
  process.env.SITE_URL,
  process.env.VERCEL_PROJECT_PRODUCTION_URL,
  process.env.VERCEL_URL,
  SITE_URL,
]
  .map(trustedDomain)
  .filter((domain) => domain !== null)
  .filter((domain, index, domains) =>
    domains.findIndex(
      (candidate) =>
        candidate.hostname === domain.hostname &&
        candidate.port === domain.port,
    ) === index,
  );

export default defineConfig({
  site: SITE_URL,
  output: 'server',
  adapter: vercel({ maxDuration: 60 }),
  integrations: [react()],
  // Keep Astro's built-in CSRF protection enabled. Exact host patterns let
  // Astro trust Vercel's forwarded host while validating its forwarded protocol.
  security: { checkOrigin: true, allowedDomains: ALLOWED_DOMAINS },
  vite: {
    build: {
      chunkSizeWarningLimit: 900,
    },
  },
  devToolbar: { enabled: false },
});
