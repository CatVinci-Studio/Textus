/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { katexWoff2Only } from "./vite.katex-fonts";
import { colorMixFallback } from "./vite.color-mix-fallback";
import { devPlugins } from "./vite.dev-plugins";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), katexWoff2Only(), devPlugins()],
  css: { postcss: { plugins: [colorMixFallback()] } },
  // The oldest engines Textus runs in: WebView2 on Chromium 105 (Windows
  // 10 without updates) and WKWebView on iOS 16. Syntax newer than these
  // is lowered; APIs and CSS aren't - docs/dev/webview-support.md.
  build: { target: ["chrome105", "safari16"] },

  // Unit tests only; e2e/ holds the Playwright flows (npm run test:e2e)
  // and screenshot generators, which vitest must not try to run.
  test: {
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

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
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
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
