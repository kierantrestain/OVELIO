import { defineConfig, devices } from '@playwright/test';
import { testEnv } from './test/integration/client';

export default defineConfig({
  testDir: './test/e2e',
  outputDir: './test-results/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90000,
  expect: { timeout: 12000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: testEnv().origin,
    launchOptions: { executablePath: process.env.OVELIO_TEST_CHROMIUM },
  },
  reporter: 'list',
});
