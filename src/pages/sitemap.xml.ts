import type { APIRoute } from 'astro';
import { getStore } from '../lib/services/context';
import { loadCategories, loadLocations } from '../lib/page-data';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function url(loc: string, lastmod?: string, changefreq = 'weekly', priority = '0.6'): string {
  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : '',
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ]
    .filter(Boolean)
    .join('\n');
}

export const GET: APIRoute = async ({ locals }) => {
  const env = locals.env;
  const site = env.siteUrl.replace(/\/+$/, '');
  const today = new Date().toISOString().slice(0, 10);

  const staticPaths: [string, string, string][] = [
    ['/', 'daily', '1.0'],
    ['/opportunities', 'daily', '0.9'],
    ['/categories', 'weekly', '0.7'],
    ['/locations', 'weekly', '0.7'],
    ['/about', 'monthly', '0.5'],
    ['/submit', 'monthly', '0.5'],
    ['/report', 'monthly', '0.3'],
    ['/privacy', 'yearly', '0.2'],
    ['/terms', 'yearly', '0.2'],
  ];

  const [categories, locations] = await Promise.all([loadCategories(env), loadLocations(env)]);
  const store = getStore(env);

  let slugs: { slug: string; updated_at: string }[] = [];
  if (store) {
    try {
      slugs = await store.listPublicSlugs();
    } catch {
      slugs = [];
    }
  }

  const entries: string[] = [];
  for (const [path, changefreq, priority] of staticPaths) {
    entries.push(url(`${site}${path}`, today, changefreq, priority));
  }
  for (const category of categories.data) {
    entries.push(url(`${site}/categories/${category.slug}`, today, 'weekly', '0.6'));
  }
  for (const location of locations.data) {
    entries.push(url(`${site}/locations/${location.slug}`, today, 'weekly', '0.5'));
  }
  for (const opportunity of slugs) {
    entries.push(url(`${site}/opportunities/${opportunity.slug}`, opportunity.updated_at, 'daily', '0.8'));
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
  ].join('\n');

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
