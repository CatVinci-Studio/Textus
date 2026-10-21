import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

/**
 * The libraries official plugins use (public/plugins/official/), taken from
 * node_modules - kept out of the repository and out of the app's own
 * bundle, served beside each plugin in development and written there in a
 * build. A plugin's webview loads them as its own files
 * (webview.asWebviewUri("lib/…")).
 */
const LIBS: Record<string, string> = {
  "plugins/official/catvinci.pdf-viewer/lib/pdf.min.mjs":
    "pdfjs-dist/legacy/build/pdf.min.mjs",
  "plugins/official/catvinci.pdf-viewer/lib/pdf.worker.min.mjs":
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  "plugins/official/catvinci.word-reader/lib/jszip.min.js":
    "jszip/dist/jszip.min.js",
  "plugins/official/catvinci.word-reader/lib/docx-preview.min.js":
    "docx-preview/dist/docx-preview.min.js",
};

const source = (lib: string) =>
  readFileSync(join(process.cwd(), "node_modules", lib));

export function officialPluginLibs(): Plugin {
  return {
    name: "textus-official-plugin-libs",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? "").split("?")[0]).replace(
          /^\//,
          "",
        );
        const lib = LIBS[path];
        if (!lib) return next();
        res.setHeader("Content-Type", "text/javascript");
        res.end(source(lib));
      });
    },
    generateBundle() {
      for (const [fileName, lib] of Object.entries(LIBS))
        this.emitFile({ type: "asset", fileName, source: source(lib) });
    },
  };
}
