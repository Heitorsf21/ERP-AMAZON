import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3107);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run dev:web -- --port ${port}`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
      SESSION_SECRET:
        process.env.SESSION_SECRET ??
        "playwright-session-secret-0123456789abcdef0123456789abcdef",
      TENANT_ISOLATION: process.env.TENANT_ISOLATION ?? "off",
      ADS_OPTIMIZER_EXECUTION_MODE:
        process.env.ADS_OPTIMIZER_EXECUTION_MODE ?? "dry_run",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
