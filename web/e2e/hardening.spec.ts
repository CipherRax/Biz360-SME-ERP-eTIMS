import { test, expect, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL;
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD;

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard/);
}

test.describe('Route protection (edge middleware)', () => {
  test('redirects unauthenticated visitors from a protected route to login', async ({ page }) => {
    await page.context().clearCookies();
    const response = await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    expect(response?.url()).toContain('/login');
    expect(response?.url()).toContain('next=%2Fdashboard');
    await expect(page.getByRole('heading', { name: /Sign in to Biz360/i })).toBeVisible();
  });

  const protectedPaths = [
    '/customers',
    '/suppliers',
    '/products',
    '/inventory',
    '/sales/invoices',
    '/purchases/purchase-orders',
    '/accounting',
    '/etims',
    '/reports',
    '/settings',
  ];

  for (const path of protectedPaths) {
    test(`protects ${path}`, async ({ page }) => {
      await page.context().clearCookies();
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(page.url()).toContain('/login');
    });
  }

  test('serves the public auth pages without a session', async ({ page }) => {
    await page.context().clearCookies();
    for (const path of ['/login', '/register', '/forgot-password']) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
    }
  });
});

test.describe('Security headers', () => {
  test('sets a strict baseline of hardening headers', async ({ request }) => {
    const response = await request.get('/login');
    const headers = response.headers();

    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});

test.describe('Role guards', () => {
  test('a Staff user is blocked from the Admin settings area', async ({ page }) => {
    test.skip(!STAFF_EMAIL || !STAFF_PASSWORD, 'Set E2E_STAFF_EMAIL/E2E_STAFF_PASSWORD to run');
    await login(page, STAFF_EMAIL!, STAFF_PASSWORD!);

    await page.goto('/settings');
    await expect(page).toHaveURL(/\/forbidden/);
    await expect(page.getByRole('heading', { name: /Access denied/i })).toBeVisible();
  });

  test('an Admin reaches the settings area', async ({ page }) => {
    test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'Set E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD to run');
    await login(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });
});

test.describe('Duplicate submission prevention', () => {
  test('double-clicking Create invoice issues a single POST', async ({ page }) => {
    test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'Set E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD to run');
    await login(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);

    let invoicePosts = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/v1/invoices')) {
        invoicePosts += 1;
      }
    });

    await page.goto('/sales/invoices/new');
    await page.getByLabel('Customer').selectOption({ index: 1 });
    await page.getByLabel('Unit price').first().fill('1000');
    await page.getByLabel('Description').first().fill('E2E double-submit item');

    const create = page.getByRole('button', { name: /Create invoice/i });
    await Promise.all([create.click(), create.click({ force: true })]);

    await expect(page.getByRole('button', { name: /Create invoice/i })).toBeDisabled();
    // Give any stray request a moment to fire before asserting.
    await page.waitForTimeout(1500);
    expect(invoicePosts).toBe(1);
  });
});