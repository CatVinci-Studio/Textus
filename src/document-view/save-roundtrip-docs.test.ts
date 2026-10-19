// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { hashString, roundTripFile } from "./save-roundtrip";

// The save round trip (save-roundtrip.test.ts) on the developer and
// design docs in `docs/`: real Markdown of ours, some of it long - seven
// loads of ai-eval.md, over 100 KB, take seconds on a CI runner.

vi.mock("mermaid", () => ({
  default: { initialize() {}, render: () => new Promise(() => {}) },
}));
// An image at an absolute path is shown through Tauri's asset protocol.
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<object>()),
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));
const css = (globalThis.CSS ?? {}) as { escape?: (value: string) => string };
css.escape ??= (value) => value.replace(/["\\]/g, "\\$&");
(globalThis as { CSS?: unknown }).CSS = css;

/** The Markdown files under `dir`, as [path, text]. */
function markdownFiles(dir: string): [string, string][] {
  const root = process.cwd();
  const found: [string, string][] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(join(root, folder), {
      withFileTypes: true,
    })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".md"))
        found.push([path, readFileSync(join(root, path), "utf8")]);
    }
  };
  walk(dir);
  return found;
}

// CI runs these once, in `check`, and only for a change that can reach
// saving (scripts/ci-changes.mjs); the native jobs set this to skip them.
describe.skipIf(process.env.TEXTUS_SKIP_ROUNDTRIP === "1")(
  "saving after an edit keeps the rest of the developer and design docs and loses nothing",
  () => {
    it.each(markdownFiles("docs"))(
      "%s",
      async (id, markdown) => {
        const report = await roundTripFile(markdown, hashString(id));
        expect(report.failures).toEqual([]);
        expect(report.unpaired).toBe(false);
      },
      60_000,
    );
  },
);
