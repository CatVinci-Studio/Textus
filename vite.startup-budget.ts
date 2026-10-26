import type { Plugin } from "vite";

// The entry chunk every window loads before its first frame. A build whose
// entry outgrows this fails, so heavy parts stay lazy.
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
