import { defineConfig, devices } from "@playwright/test";

/**
 * The e2e flows (e2e/*.spec.ts): the frontend in Chromium against the Vite
 * dev server, with the dev Tauri shim standing in for the backend
 * (src/dev/tauri-shim.ts).
 *
 *   npm run test:e2e      every flow, screenshots not compared - the same on
 *                         Linux, macOS and Windows, and what CI runs
 *   npm run test:visual   the same flows comparing visual.spec.ts's
 *                         screenshots against e2e/visual.spec.ts-snapshots/,
 *                         which are Linux baselines (fonts differ elsewhere);
 *                         after an intended UI change, on Linux:
 *                         `npm run test:visual -- --update-snapshots`
 *
 * The page's locale, time zone and colour scheme are fixed below, so a run
 * does not depend on the machine's own.
 *
 * Native behaviour (windows, dialogs, single instance) isn't reachable from
 * here - scripts/smoke-linux.sh covers the built app.
 *
 * PLAYWRIGHT_PORT moves the dev server off 1430, for running a second copy
 * of the suite (another worktree) beside a first.
 */
const port = Number(process.env.PLAYWRIGHT_PORT) || 1430;

export default defineConfig({
  testDir: "./e2e",
  // Screenshot generators run on their own (playwright.shots.config.ts).
  testIgnore: ["shots/**"],
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  // On CI a failed test runs once more. One that passes the second time is
  // reported as "flaky" - named in the list's summary and as a GitHub
  // annotation - and doesn't fail the job, so a flake is seen without
  // blocking a merge. Locally a failure is a failure: no retry.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  expect: {
    // A tight per-pixel threshold: the default (0.2) reads a light panel tint
    // such as the code-block background as plain white.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.05,
      animations: "disabled",
    },
  },
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1180, height: 780 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "light",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1180, height: 780 },
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
