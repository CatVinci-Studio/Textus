import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/**
 * The motion benchmark: frame timing for every animated surface, animations
 * on. A measurement, not a test; CI doesn't run it.
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
