// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://hustlercommunity-opportunities.vercel.app';

export default defineConfig({
  site: SITE_URL,
  output: 'server',
  adapter: vercel({ maxDuration: 60 }),
  integrations: [react()],
  vite: {
    build: {
      chunkSizeWarningLimit: 900,
    },
  },
  devToolbar: { enabled: false },
});
