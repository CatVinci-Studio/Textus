import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/**
 * Screenshot generators (e2e/shots/), not tests: they write images for a
 * person to look at and assert nothing CI needs. One project each:
 *
 *   npm run screenshots:readme    the README's images, docs/images/readme/
 *   npm run screenshots:website   the website's app shots (see the spec's header)
 *   npm run screenshots:review    design-review shots; set TEXTUS_SHOTS_DIR
 *                                 to where they go, or they skip
 */
export default defineConfig({
  ...base,
  testDir: "./e2e/shots",
  testIgnore: [],
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
    {
      name: "review",
      testDir: "./e2e/shots/review",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1180, height: 780 },
      },
    },
  ],
});
