import { defineConfig, devices } from '@playwright/test';

// Preview-mode browser harness (UX lane). Runs against an existing production build in developer preview mode:
//   npm run build && npm run test:e2e:preview
// No Docker needed: the preview runs every migration on embedded PGlite with labelled sample data.
// Set OVELIO_TEST_CHROMIUM to use a locally installed Chromium instead of Playwright's download.
const port = Number(process.env.OVELIO_PREVIEW_PORT || 3206);
const origin = `http://localhost:${port}`;

// The specs in test/e2e/preview skip themselves unless this config loaded them (the CI config also scans test/e2e).
process.env.OVELIO_PREVIEW_E2E = '1';

export default defineConfig({
  testDir: './test/e2e/preview',
  outputDir: './test-results/preview',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['./test/e2e/preview/pending-reporter.ts']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: origin,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    launchOptions: { executablePath: process.env.OVELIO_TEST_CHROMIUM || '/opt/pw-browsers/chromium' },
  },
  // The evidence sweep runs first on clean seeded data; specs that create records run after it.
  projects: [
    { name: 'desktop', testMatch: /(workspaces|keyboard)\.spec\.ts$/, use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', testMatch: /(workspaces|keyboard)\.spec\.ts$/, use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true } },
    { name: 'journeys', testMatch: /(journeys|features)\.spec\.ts$/, dependencies: ['desktop', 'mobile'], use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npx next start -p ${port}`,
    url: origin + '/login',
    env: { OVELIO_DEV_PREVIEW: 'true', NEXT_TELEMETRY_DISABLED: '1' },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
