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

export default defineConfig({
  site: SITE_URL,
  output: 'server',
  adapter: vercel({ maxDuration: 60 }),
  integrations: [react()],
  // Every mutating route calls assertSameOrigin() itself. The built-in check
  // compares against a proxy-reconstructed URL and rejects valid HTTPS logins
  // behind Vercel's TLS termination ("Cross-site POST form submissions are
  // forbidden"). See src/lib/http.ts and tests/unit/request-origin.test.ts.
  security: { checkOrigin: false },
  vite: {
    build: {
      chunkSizeWarningLimit: 900,
    },
  },
  devToolbar: { enabled: false },
});
