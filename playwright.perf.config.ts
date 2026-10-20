import { defineConfig, devices } from "@playwright/test";

/**
 * The large-document benchmark (e2e/perf/large-doc.perf.ts, design §6.4):
 * `npm run bench:large-doc`. Kept out of `npm run test:e2e` and CI - it
 * measures, it doesn't pass or fail, and one run takes minutes.
 *
 * PLAYWRIGHT_PORT moves its dev server, as in playwright.config.ts (the
 * default here is 1450, clear of the e2e suite's 1430).
 */
const port = Number(process.env.PLAYWRIGHT_PORT) || 1450;

export default defineConfig({
  testDir: "./e2e/perf",
  testMatch: "*.perf.ts",
  outputDir: "test-results/perf-run",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1180, height: 780 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "light",
  },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
