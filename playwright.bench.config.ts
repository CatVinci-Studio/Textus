import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/**
 * The motion benchmark (e2e/bench/motion.bench.ts): frame timing for every
 * animated surface, with the animations on. A measurement for comparing
 * changes, not a test - CI doesn't run it.
 *
 *   npm run bench:motion
 *
 * Only the main window's dev server; the playground's isn't needed.
 */
export default defineConfig({
  ...base,
  testDir: "./e2e/bench",
  testMatch: "*.bench.ts",
  testIgnore: [],
  timeout: 120_000,
  retries: 0,
  webServer: Array.isArray(base.webServer)
    ? base.webServer.slice(0, 1)
    : base.webServer,
  projects: [
    {
      name: "bench",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
