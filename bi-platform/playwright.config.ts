import { defineConfig } from '@playwright/test';

// Set PW_CHROMIUM_PATH to use a Chromium binary you already have (otherwise Playwright's own download is used).
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60000,
  use: { baseURL: 'http://localhost:3123', headless: true, launchOptions: { executablePath, args: executablePath ? ['--no-sandbox'] : [] } },
  webServer: {
    command: 'npx serve out -l 3123 -n',
    url: 'http://localhost:3123',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
