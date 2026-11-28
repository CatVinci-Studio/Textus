#!/usr/bin/env node
// The app built for the engine benchmark (e2e/bench/engine-*.bench.ts): a
// production build - React's production bundle, the real chunks - with the
// dev Tauri shim switched on so a browser can drive it, and left
// unminified so the probe can name the source module behind a style write
// (each module keeps its `//#region src/...` marker). Not CI.
import { build } from "vite";

const OUT = process.env.BENCH_DIST ?? "node_modules/.cache/engine-bench-dist";

await build({
  configFile: "vite.config.ts",
  mode: "production",
  logLevel: "warn",
  build: {
    outDir: OUT,
    emptyOutDir: true,
    minify: false,
    // The startup budget counts minified bytes: an unminified entry would
    // fail it for nothing, so the entry is named out of its sight.
    rolldownOptions: { output: { entryFileNames: "assets/bench-[hash].js" } },
  },
  plugins: [
    {
      name: "bench-dev-shim",
      enforce: "pre",
      transform(code, id) {
        if (!id.includes("/src/") || !code.includes("import.meta.env.DEV"))
          return null;
        return code.replaceAll("import.meta.env.DEV", "true");
      },
    },
  ],
});
console.log(`engine bench: app built into ${OUT}`);
