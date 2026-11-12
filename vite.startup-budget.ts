import type { Plugin } from "vite";

// The entry chunk every window loads before its first frame. A build whose
// entry outgrows this fails, so heavy parts stay lazy. Startup time is what
// counts; the size is the check a build can make.
const BUDGET_BYTES = 900_000;

export function startupBudget(): Plugin {
  return {
    name: "textus-startup-budget",
    apply: "build",
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || !chunk.isEntry) continue;
        if (!chunk.fileName.startsWith("assets/index-")) continue;
        const size = Buffer.byteLength(chunk.code);
        if (size <= BUDGET_BYTES) continue;
        // The largest parts of it, to say where to look.
        const largest = Object.entries(chunk.modules)
          .sort(([, a], [, b]) => b.renderedLength - a.renderedLength)
          .slice(0, 12)
          .map(
            ([id, m]) =>
              `  ${(m.renderedLength / 1e3).toFixed(0).padStart(5)} KB  ` +
              id.replace(/^.*?\/(node_modules|src)\//, "$1/"),
          );
        this.error(
          `The startup chunk is ${(size / 1e6).toFixed(2)} MB, over its ` +
            `${(BUDGET_BYTES / 1e6).toFixed(2)} MB budget: something heavy ` +
            `is imported at startup - load it on first use ` +
            `(src/lazy/lazy-module.ts). Largest parts:\n${largest.join("\n")}`,
        );
      }
    },
  };
}
