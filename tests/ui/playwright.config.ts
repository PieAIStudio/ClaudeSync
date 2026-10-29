import { defineConfig } from '@playwright/test';

const port = Number(process.env.UI_TEST_PORT ?? 4173);
const report = process.env.UI_TEST_REPORT ?? '.reports/2026-10-29-ui-smoke/playwright.json';

export default defineConfig({
  testDir: '.',
  testMatch: 'smoke.spec.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.UI_TEST_REPORTER === 'json' ? [['json', { outputFile: report }]] : [['line']],
  outputDir: '../../.reports/2026-10-29-ui-smoke/playwright-output',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'zh-CN',
    colorScheme: 'light',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `node serve-renderer.mjs --port=${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
