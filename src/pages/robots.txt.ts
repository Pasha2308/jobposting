import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ locals }) => {
  const site = locals.env.siteUrl.replace(/\/+$/, '');
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /api/',
    'Disallow: /report',
    '',
    `Sitemap: ${site}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' },
  });
};
