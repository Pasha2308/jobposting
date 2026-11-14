// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';

const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://hustlercommunity-opportunities.pages.dev';

export default defineConfig({
  site: SITE_URL,
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  integrations: [react()],
  vite: {
    build: {
      // Keep bundle size predictable on the Workers free tier.
      chunkSizeWarningLimit: 900,
    },
  },
  devToolbar: { enabled: false },
});
