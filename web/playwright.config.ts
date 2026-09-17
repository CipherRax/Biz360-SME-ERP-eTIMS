import { defineConfig, devices } from '@playwright/test';

// Hardening e2e suite. Starts the Next app on :3001; the NestJS API is expected
// to be running on :3000 for the authenticated specs (see web/SECURITY.md).
const PORT = Number(process.env.PORT ?? 3001);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    extraHTTPHeaders: { Accept: 'text/html,application/xhtml+xml' },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next dev -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});