import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * The e2e flows in the oldest engine Textus supports on Windows, WebView2
 * on Chromium 105 (docs/dev/webview-support.md). Playwright's own Chromium
 * is too new to show what an old engine drops, so this runs a Chromium
 * build you point it at:
 *
 *   OLD_CHROMIUM=/path/to/chrome-linux/chrome \
 *     npx playwright test -c playwright.webview.config.ts settings.spec.ts
 *
 * It runs the built frontend, as the app ships it (Vite lowers syntax for
 * build.target, the dev server doesn't), in development mode so the dev
 * Tauri shim is in it. Not run by CI; screenshots are not compared.
 */
const executablePath = process.env.OLD_CHROMIUM;
if (!executablePath) {
  throw new Error("Set OLD_CHROMIUM to the Chromium executable to test.");
}
const port = Number(process.env.PLAYWRIGHT_PORT) || 1460;
// Per port, so two runs (two worktrees) don't build over each other.
const outDir = `.cache/webview-dist-${port}`;

export default defineConfig({
  ...base,
  outputDir: "test-results/webview-run",
  ignoreSnapshots: true,
  projects: [
    {
      name: "old-chromium",
      testIgnore: ["shots/**", "playground.spec.ts"],
      use: {
        ...base.use,
        baseURL: `http://localhost:${port}`,
        launchOptions: { executablePath },
      },
    },
  ],
  webServer: {
    command: `npx vite build --mode development --outDir ${outDir} --emptyOutDir && npx vite preview --outDir ${outDir} --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    // With NODE_ENV=development the build keeps import.meta.env.DEV on.
    env: { NODE_ENV: "development" },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
