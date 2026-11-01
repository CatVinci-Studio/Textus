import { defineConfig, devices } from "@playwright/test";

/**
 * The e2e flows: the frontend in Chromium against the Vite dev server, with
 * the dev Tauri shim standing in for the backend. Visual baselines are Linux
 * only, since fonts differ. PLAYWRIGHT_PORT lets a second worktree run too.
 */
const port = Number(process.env.PLAYWRIGHT_PORT) || 1430;
// Far from the app's port: worktrees pick ports ten apart (1430, 1440, ...),
// and a nearer offset landed on another run's app server.
const playgroundPort = port + 1000;
/** The specs the opt-in WebKit project runs (projects below). */
const WEBKIT_SPECS = [
  // How AI text lands and leaves: timing differs in WebKit. Not
  // landing-beat.spec.ts, which compares two animations frame by frame:
  // a busy runner's frames, not WebKit, decide that there.
  "settle-motion.spec.ts",
  "motion-edge-cases.spec.ts",
  "translate-stream.spec.ts",
  "insert-in-paragraph.spec.ts",
  "stream-edge-cases.spec.ts",
  "revise-stream.spec.ts",
  "agent-image.spec.ts",
  // A wide diagram scrolls from its left edge: WebKit lays out flex overflow
  // on its own.
  "diagram-fit.spec.ts",
  "drag-autoscroll.spec.ts",
  "api-key-field.spec.ts",
  "sidebar-toggle.spec.ts",
  "tab-scroll.spec.ts",
  "markdown-keys.spec.ts",
  "code-block.spec.ts",
  "link-reveal.spec.ts",
  "sidebar-resize.spec.ts",
  "keyboard.spec.ts",
  "file-tree.spec.ts",
  "user-css.spec.ts",
  "plugins.spec.ts",
  "large-doc-lazy.spec.ts",
];

export default defineConfig({
  testDir: "./e2e",
  // Screenshot generators run on their own.
  testIgnore: ["shots/**"],
  timeout: 30_000,
  // Tests share nothing, so tests rather than files spread over workers and
  // shards, which keeps the shards even.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 1,
  // On CI a flake is reported without blocking a merge; locally a failure
  // is a failure.
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
      testIgnore: ["shots/**", "playground.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1180, height: 780 },
      },
    },
    {
      name: "playground",
      testMatch: "playground.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1180, height: 780 },
        baseURL: `http://localhost:${playgroundPort}`,
        locale: "en-US",
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
    {
      command: `npx vite --config vite.playground.config.ts --port ${playgroundPort} --strictPort`,
      url: `http://localhost:${playgroundPort}/playground/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
