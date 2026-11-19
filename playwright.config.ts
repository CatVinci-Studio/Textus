import { defineConfig, devices } from "@playwright/test";

/**
 * The e2e flows: the frontend in Chromium against the Vite dev server, with
 * the dev Tauri shim standing in for the backend. PLAYWRIGHT_PORT lets a
 * second worktree run too.
 */
const port = Number(process.env.PLAYWRIGHT_PORT) || 1430;

// The frame claims' own checks go with the frame flows (@perf).
const ignored = process.env.TEXTUS_PERF
  ? ["shots/**"]
  : ["shots/**", "frames/claims.spec.ts"];

export default defineConfig({
  testDir: "./e2e",
  // Screenshot generators run on their own.
  testIgnore: ["shots/**"],
  // Stopwatch tests (@perf: frame budgets, frame-by-frame slides) depend on
  // the machine's load: they run with `npm run test:perf`, never in CI.
  grepInvert: process.env.TEXTUS_PERF ? undefined : /@perf/,
  grep: process.env.TEXTUS_PERF ? /@perf/ : undefined,
  timeout: 30_000,
  // Tests share nothing, so tests rather than files spread over workers and
  // shards, which keeps the shards even.
  fullyParallel: true,
  // Four locally: the whole run in minutes; CI's runners take two.
  workers: process.env.CI ? 2 : 4,
  // On CI a test that passes only on its retry is listed apart (flaky, a
  // warning on the pull request by the github reporter) without blocking
  // a merge; locally a failure is a failure.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1180, height: 780 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "light",
    // A failed attempt on CI leaves its trace, a retry that passed too.
    trace: process.env.CI ? "retain-on-failure" : "off",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: ignored,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1180, height: 780 },
      },
    },
    // The same flows in Playwright's WebKit, with E2E_WEBKIT=1 (CI's
    // e2e-webkit job sets it on every pull request).
    ...(process.env.E2E_WEBKIT
      ? [
          {
            name: "webkit",
            testIgnore: ignored,
            use: {
              ...devices["Desktop Safari"],
              viewport: { width: 1180, height: 780 },
            },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: `npx vite --port ${port} --strictPort`,
      url: `http://localhost:${port}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
