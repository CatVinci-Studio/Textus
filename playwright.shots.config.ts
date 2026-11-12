import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/**
 * Screenshot generators, not tests: they write images for a person to look
 * at (the README's, the website's).
 */
export default defineConfig({
  ...base,
  testDir: "./e2e/shots",
  testIgnore: [],
  // A shot that misses its moment under load is taken again.
  retries: 1,
  projects: [
    {
      name: "readme",
      testDir: "./e2e/shots/readme",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1180, height: 780 },
      },
    },
    {
      name: "website",
      testDir: "./e2e/shots/website",
      // Each test is one language's whole set, Mermaid and KaTeX included.
      timeout: 180_000,
      // A 1440x900 window at 2x, light appearance.
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: "light",
      },
    },
  ],
});
