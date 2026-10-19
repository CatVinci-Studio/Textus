// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { hashString, roundTripFile } from "./save-roundtrip";
import { snippetDocuments } from "./save-roundtrip-snippets";

// The save round trip (docs/dev/saving.md) on a fixed set that runs in CI:
// generated snippets of every construct and the shapes the corpus run found
// bugs in; this repository's own Markdown is in save-roundtrip-docs.test.ts
// and save-roundtrip-help.test.ts, so the three run in parallel. Each
// document is opened, saved unedited (byte for byte the file), and edited
// six ways on fresh loads, with the untouched blocks checked byte for byte
// and the text read back. The full corpus is `npm run test:roundtrip`.

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

describe("saving after an edit keeps the rest and loses nothing", () => {
  it.each(snippetDocuments(250))("%s", async (id, markdown) => {
    const report = await roundTripFile(markdown, hashString(id));
    expect(report.failures).toEqual([]);
    expect(report.unpaired).toBe(false);
  });
});
