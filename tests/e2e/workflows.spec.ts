import { expect, test, type Page } from '@playwright/test';

/**
 * Authenticated end-to-end workflows A–H.
 *
 * These require a real, seeded Supabase project plus a first admin account and
 * an AI provider (Groq by default, Gemini if configured). They are skipped
 * unless the E2E_* variables are supplied, so the public smoke suite can still
 * run locally and in CI without credentials.
 *
 * Required:
 *   E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD
 *   E2E_AI_CONFIGURED=1 (for capture/extraction workflows)
 *   E2E_TELEGRAM_SECRET (for webhook verification workflow)
 */

const configured = Boolean(
  process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD && process.env.E2E_SUPABASE_URL,
);
const aiConfigured = configured && process.env.E2E_AI_CONFIGURED === '1';
const telegramSecret = process.env.E2E_TELEGRAM_SECRET;

async function signIn(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.locator('#email').fill(process.env.E2E_ADMIN_EMAIL ?? '');
  await page.locator('#password').fill(process.env.E2E_ADMIN_PASSWORD ?? '');
  await page.getByRole('button', { name: /Sign in/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function createDraft(page: Page, title: string): Promise<void> {
  await page.goto('/admin/opportunities/new');
  await page.locator('#title').fill(title);
  await page.locator('#company_name').fill('E2E Test Company');
  await page.locator('#category_id').selectOption({ index: 1 });
  await page
    .locator('#summary')
    .fill('An end-to-end test opportunity created by the automated lifecycle suite. It exists only in the test project.');
  await page.locator('#location_text').fill('Bengaluru, India');
  await page.locator('#city').fill('Bengaluru');
  await page.locator('#country').fill('India');
  await page.locator('#work_mode').selectOption('hybrid');
  await page.locator('#application_url').fill('https://example.com/e2e-application');
  await page.locator('#source_url').fill(`https://example.com/e2e-source-${Date.now()}`);
  await page.getByRole('button', { name: /Create draft/i }).click();
  await expect(page).toHaveURL(/\/admin\/opportunities\/[0-9a-f-]+/);
}

test.describe('workflows A–H', () => {
  test.skip(!configured, 'Requires E2E_SUPABASE_URL plus E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD.');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('A. capture a pasted post into a reviewed draft', async ({ page }) => {
    test.skip(!aiConfigured, 'Requires a configured AI key (E2E_AI_CONFIGURED=1).');
    await page.goto('/admin/capture');
    await page.locator('#source_url').fill(`https://www.linkedin.com/posts/e2e_hiring-${Date.now()}`);
    await page
      .locator('#raw_text')
      .fill(
        'E2E Test Company is hiring a Founder Associate. You will work directly with the founder on strategy and operations. This is a remote role in India. Apply at https://example.com/e2e-application.',
      );
    await page.getByRole('button', { name: /Capture & extract/i }).click();
    await expect(page.locator('[data-capture-status]')).toContainText(/capture|extract/i, { timeout: 45_000 });
    await expect(page.locator('[data-capture-error]')).toBeHidden();
  });

  test('B. review a draft and publish through the validated gate', async ({ page }) => {
    const title = `E2E Founder Associate ${Date.now()}`;
    await createDraft(page, title);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /^Publish$/ }).click();
    await expect(page.getByRole('status').filter({ hasText: /Published/i })).toBeVisible({ timeout: 20_000 });
  });

  test('C. the published opportunity appears in public search', async ({ page }) => {
    const title = `E2E Searchable Role ${Date.now()}`;
    await createDraft(page, title);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /^Publish$/ }).click();
    await expect(page.getByRole('status').filter({ hasText: /Published/i })).toBeVisible({ timeout: 20_000 });

    await page.goto(`/opportunities?q=${encodeURIComponent(title)}`);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  });

  test('D. public sharing uses the real canonical URL and tracks outbound clicks', async ({ page }) => {
    const title = `E2E Shareable Role ${Date.now()}`;
    await createDraft(page, title);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /^Publish$/ }).click();
    await expect(page.getByRole('status').filter({ hasText: /Published/i })).toBeVisible({ timeout: 20_000 });

    await page.goto(`/opportunities?q=${encodeURIComponent(title)}`);
    await page.getByRole('heading', { name: title }).click();
    const shareBar = page.locator('[data-share-bar]');
    const publicUrl = await shareBar.getAttribute('data-url');
    expect(publicUrl).toMatch(/\/opportunities\//);
    await expect(page.getByRole('link', { name: 'LinkedIn', exact: true })).toHaveAttribute(
      'href',
      new RegExp(`url=${encodeURIComponent(publicUrl ?? '')}`),
    );
    await expect(page.getByRole('link', { name: 'WhatsApp', exact: true })).toBeVisible();
  });

  test('E. a public report is received and can be resolved by an admin', async ({ page }) => {
    const title = `E2E Reportable Role ${Date.now()}`;
    await createDraft(page, title);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /^Publish$/ }).click();
    await expect(page.getByRole('status').filter({ hasText: /Published/i })).toBeVisible({ timeout: 20_000 });

    await page.goto(`/opportunities?q=${encodeURIComponent(title)}`);
    await page.getByRole('heading', { name: title }).click();
    await page.getByRole('link', { name: /Report this listing/i }).click();
    await page.locator('#reason').selectOption('incorrect_info');
    await page.locator('#details').fill('E2E report: details need checking.');
    await page.getByRole('button', { name: /Send report/i }).click();
    await expect(page.getByText(/Report received/i)).toBeVisible();

    await page.goto('/admin/reports');
    await expect(page.getByText(/E2E report: details need checking/i).first()).toBeVisible();
  });

  test('F. closing a live role preserves the page but removes it from search', async ({ page }) => {
    const title = `E2E Closing Role ${Date.now()}`;
    await createDraft(page, title);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /^Publish$/ }).click();
    await expect(page.getByRole('status').filter({ hasText: /Published/i })).toBeVisible({ timeout: 20_000 });

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /^Close$/ }).click();
    await expect(page.getByRole('status').filter({ hasText: /closed/i })).toBeVisible({ timeout: 20_000 });

    await page.goto(`/opportunities?q=${encodeURIComponent(title)}`);
    await expect(page.getByText(/No roles match these filters/i)).toBeVisible();
  });

  test('G. Telegram webhook rejects a bad secret and a malformed update', async ({ request }) => {
    test.skip(!telegramSecret, 'Requires E2E_TELEGRAM_SECRET.');
    const bad = await request.post('/api/telegram/webhook', {
      headers: { 'x-telegram-bot-api-secret-token': 'definitely-wrong' },
      data: { update_id: 1 },
    });
    expect(bad.status()).toBe(403);

    const malformed = await request.post('/api/telegram/webhook', {
      headers: { 'x-telegram-bot-api-secret-token': telegramSecret ?? '' },
      data: { not_an_update: true },
    });
    expect(malformed.status()).toBe(400);
  });

  test('H. duplicate source URLs are blocked without creating a second record', async ({ page }) => {
    test.skip(!aiConfigured, 'Requires a configured AI key (E2E_AI_CONFIGURED=1).');
    const source = `https://www.linkedin.com/posts/e2e_duplicate-${Date.now()}`;
    const text =
      'E2E Test Company is hiring a Growth Associate. You will own lifecycle campaigns and work with the founder. Remote in India. Apply at https://example.com/e2e-application.';

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.goto('/admin/capture');
      await page.locator('#source_url').fill(source);
      await page.locator('#raw_text').fill(text);
      await page.getByRole('button', { name: /Capture & extract/i }).click();
      await expect(page.locator('[data-capture-status], [data-capture-error]').first()).toBeVisible({
        timeout: 45_000,
      });
    }

    await expect(page.locator('[data-capture-error]')).toContainText(/already been captured|duplicate/i);
  });
});
