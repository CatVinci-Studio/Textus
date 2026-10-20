import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { katexWoff2Only } from "./vite.katex-fonts";
import { colorMixFallback } from "./vite.color-mix-fallback";

/**
 * The browser playground (src/playground/): the editor alone, served from
 * textus.catvinci.com/playground/. Its own build, into dist-playground/, so
 * the app's `npm run build` and dist/ stay exactly as they are.
 *
 *   npm run build:playground   builds dist-playground/playground/
 *   npm run dev:playground     serves it at http://localhost:1450/playground/
 */

const ENTRY = "playground.html";

/** The entry is playground.html (index.html is the app's), but the page is
 *  served as /playground/ - its index.html - in the build and in dev. */
function servedAsIndex(): Plugin {
  return {
    name: "playground-index",
    // After Vite has emitted the page.
    enforce: "post",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/playground/" || req.url === "/playground/index.html")
          req.url = `/playground/${ENTRY}`;
        next();
      });
    },
    generateBundle(_options, bundle) {
      const page = bundle[ENTRY];
      if (page) page.fileName = "index.html";
    },
  };
}

export default defineConfig({
  plugins: [react(), katexWoff2Only(), servedAsIndex()],
  css: { postcss: { plugins: [colorMixFallback()] } },
  base: "/playground/",
  // public/ holds the app's files.
  publicDir: false,
  clearScreen: false,
  server: { port: 1450 },
  // Not the app's: the e2e run serves both at once, and two dev servers
  // optimizing into one cache reloaded each other's pages mid-test.
  cacheDir: "node_modules/.vite-playground",
  build: {
    // dist-playground/ is the site root the Worker serves
    // (wrangler.playground.jsonc), so the files sit under /playground/ there.
    outDir: "dist-playground/playground",
    emptyOutDir: true,
    rollupOptions: { input: ENTRY },
  },
});
