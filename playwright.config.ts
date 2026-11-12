import { defineConfig, devices } from "@playwright/test";

/**
 * The e2e flows: the frontend in Chromium against the Vite dev server, with
 * the dev Tauri shim standing in for the backend. PLAYWRIGHT_PORT lets a
 * second worktree run too.
 */
const port = Number(process.env.PLAYWRIGHT_PORT) || 1430;
/** The specs the opt-in WebKit project runs (projects below). */
const WEBKIT_SPECS = [
  // The frame engine and the one editor per island: Mac draws in WebKit,
  // whose layout and clip-path the islands' motion leans on.
  "ai-tabs.spec.ts",
  "editor-per-island.spec.ts",
  "sidebar-panels.spec.ts",
  "tab-from-window.spec.ts",
  "island-numbers.spec.ts",
  "frames.spec.ts",
];

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
  // On CI a flake is reported without blocking a merge; locally a failure
  // is a failure.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
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
      // The frame claims' own checks go with the frame flows (@perf).
      testIgnore: process.env.TEXTUS_PERF
        ? ["shots/**"]
        : ["shots/**", "frames/claims.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1180, height: 780 },
      },
    },
    // WebKit-only flows in Playwright's WebKit, opt in with E2E_WEBKIT=1;
    // CI doesn't run them.
    ...(process.env.E2E_WEBKIT
      ? [
          {
            name: "webkit",
            testMatch: WEBKIT_SPECS,
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
