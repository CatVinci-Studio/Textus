import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * The e2e flows in the oldest WebView2 Textus supports, Chromium 105, set by
 * OLD_CHROMIUM. Runs the built frontend, since only the build lowers syntax;
 * not run by CI.
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
