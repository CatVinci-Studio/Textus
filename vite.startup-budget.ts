import type { Plugin } from "vite";

// What every window loads before its first frame: the entry chunk. Heavy
// parts load on first use instead (src/lazy/lazy-module.ts), and this keeps
// them from drifting back in - a build whose entry outgrows the budget
// fails, saying by how much. 1.2 cut it from 2.48 MB to 1.27 MB (minified),
// 1.3 to 1.02 MB: Split View, the editor's menu, the tour and the plugin
// broker load on first use.
const BUDGET_BYTES = 1_100_000;

export function startupBudget(): Plugin {
  return {
    name: "textus-startup-budget",
    apply: "build",
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || !chunk.isEntry) continue;
        if (!chunk.fileName.startsWith("assets/index-")) continue;
        const size = Buffer.byteLength(chunk.code);
        if (size > BUDGET_BYTES)
          this.error(
            `The startup chunk is ${(size / 1e6).toFixed(2)} MB, over its ` +
              `${(BUDGET_BYTES / 1e6).toFixed(2)} MB budget: something heavy ` +
              `is imported at startup - load it on first use ` +
              `(src/lazy/lazy-module.ts).`,
          );
      }
    },
  };
}
