import { expect, test } from '@playwright/test';

/**
 * Public journeys that do not require live Supabase credentials. These run in
 * CI against the local dev server and assert honest empty states rather than
 * inventing listings.
 */

test.describe('public discovery', () => {
  test('homepage states the promise and offers both primary actions', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Find Your Next');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Opportunity.');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Start Building.');
    await expect(page.getByRole('link', { name: /Explore Opportunities/i }).first()).toHaveAttribute(
      'href',
      '/opportunities',
    );
    await expect(page.getByRole('link', { name: /Submit an Opportunity/i }).first()).toHaveAttribute('href', '/submit');
  });

  test('directory exposes search, sort and the full filter set', async ({ page, isMobile }) => {
    await page.goto('/opportunities');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    if (isMobile) await page.getByRole('button', { name: /Filters/i }).click();

    await expect(page.locator('#filter-category')).toBeVisible();
    await expect(page.locator('#filter-country')).toBeVisible();
    await expect(page.locator('#filter-city')).toBeVisible();
    await expect(page.locator('#filter-experience')).toBeVisible();
    await expect(page.locator('#filters-form input[name="workMode"][value="remote"]')).toBeVisible();
    await expect(page.locator('input[name="employmentType"][value="full_time"]')).toBeVisible();
    await expect(page.locator('input[name="salary"][value="disclosed"]')).toBeVisible();
    await expect(page.locator('#directory-sort')).toBeVisible();
  });

  test('filters round-trip through shareable URLs and can be cleared', async ({ page, isMobile }) => {
    await page.goto('/opportunities');
    if (isMobile) await page.getByRole('button', { name: /Filters/i }).click();

    // Changing a filter submits the GET form automatically, producing a
    // shareable URL without requiring JavaScript for the form itself.
    const navigation = page.waitForURL(/workMode=remote/);
    await page.locator('#filters-form input[name="workMode"][value="remote"]').check();
    await navigation;

    await expect(page).toHaveURL(/workMode=remote/);
    await expect(page.getByRole('link', { name: /Clear all/i }).first()).toBeVisible();

    await page.getByRole('link', { name: /Clear all/i }).first().click();
    await expect(page).toHaveURL(/\/opportunities$/);
  });

  test('taxonomy, about and legal pages render', async ({ page }) => {
    for (const [path, heading] of [
      ['/categories', /categor/i],
      ['/locations', /location/i],
      ['/about', /Discover opportunities/i],
      ['/privacy', /privacy/i],
      ['/terms', /terms/i],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
    }
  });

  test('public submission and reporting forms are available without an account', async ({ page }) => {
    await page.goto('/submit');
    await expect(page.locator('#source_url')).toBeVisible();
    await expect(page.getByRole('button', { name: /Send for review/i })).toBeVisible();

    await page.goto('/report');
    await expect(page.locator('#opportunity_id')).toBeVisible();
    await expect(page.getByRole('button', { name: /Send report/i })).toBeVisible();
  });

  test('unknown routes return the branded 404 page', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByText(/does not exist|not found/i).first()).toBeVisible();
  });

  test('admin pages are protected by a server-side redirect', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login\?next=/);
    await expect(page.getByRole('heading', { name: /Admin sign in/i })).toBeVisible();
  });

  test('sitemap and robots endpoints are available', async ({ request }) => {
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.ok()).toBe(true);
    expect(await sitemap.text()).toContain('<urlset');

    const robots = await request.get('/robots.txt');
    expect(robots.ok()).toBe(true);
    const body = await robots.text();
    expect(body).toContain('Sitemap:');
    expect(body).toContain('Disallow: /admin');
  });
});
