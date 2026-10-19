// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { hashString, roundTripFile } from "./save-roundtrip";
import { snippetDocuments } from "./save-roundtrip-snippets";

// The save round trip (docs/dev/saving.md) on a fixed set that runs in CI:
// generated snippets of every construct, the shapes the corpus run found
// bugs in, and this repository's own Markdown. Each is opened, saved
// unedited (byte for byte the file), and edited six ways on fresh loads,
// with the untouched blocks checked byte for byte and the text read back.
// The full corpus is `npm run test:roundtrip`.

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

/** This repository's Markdown: the help guides and the docs. */
function ownDocuments(): [string, string][] {
  const root = process.cwd();
  const found: [string, string][] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".md"))
        found.push([path, readFileSync(join(root, path), "utf8")]);
    }
  };
  walk("src/help");
  walk("docs");
  return found;
}

describe("saving after an edit keeps the rest and loses nothing", () => {
  it.each([...snippetDocuments(250), ...ownDocuments()])(
    "%s",
    async (id, markdown) => {
      const report = await roundTripFile(markdown, hashString(id));
      expect(report.failures).toEqual([]);
      expect(report.unpaired).toBe(false);
    },
  );
});
