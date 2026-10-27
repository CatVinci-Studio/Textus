/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { katexWoff2Only } from "./vite.katex-fonts";
import { colorMixFallback } from "./vite.color-mix-fallback";
import { devPlugins } from "./vite.dev-plugins";
import { startupBudget } from "./vite.startup-budget";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), katexWoff2Only(), devPlugins(), startupBudget()],
  css: { postcss: { plugins: [colorMixFallback()] } },
  // The oldest engines Textus runs in. Newer syntax is lowered; APIs and
  // CSS aren't.
  build: { target: ["chrome105", "safari16"] },
  // Mermaid's own KaTeX copy would add 260 KB; it uses only renderToString,
  // which ours has unchanged.
  resolve: { dedupe: ["katex"] },

  // Unit tests only; vitest must not run the Playwright files in e2e/.
  test: {
    setupFiles: ["src/test-setup.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "e2e/**",
      "src-tauri/**",
      ".claude/**",
      ".cache/**",
      "textus-plugins/**",
    ],
  },

  // Keep Vite from obscuring Rust errors.
  clearScreen: false,
  // Tauri expects a fixed port; fail if it is taken.
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
