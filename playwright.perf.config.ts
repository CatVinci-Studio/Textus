import { defineConfig, devices } from "@playwright/test";

/**
 * The large-document benchmark, kept out of the e2e suite and CI: it
 * measures rather than passes, and one run takes minutes.
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
