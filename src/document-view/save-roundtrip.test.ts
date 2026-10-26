// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { hashString, roundTripFile } from "./save-roundtrip";
import { snippetDocuments } from "./save-roundtrip-snippets";

// The save round trip on a fixed CI set: snippets of every construct and
// shapes the corpus run found bugs in. Each document must save unedited byte
// for byte, and edited, with untouched blocks byte for byte.

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

// CI runs these once, only for changes that can reach saving; the native
// jobs set this to skip them.
describe.skipIf(process.env.TEXTUS_SKIP_ROUNDTRIP === "1")(
  "saving after an edit keeps the rest and loses nothing",
  () => {
    it.each(snippetDocuments(250))("%s", async (id, markdown) => {
      const report = await roundTripFile(markdown, hashString(id));
      expect(report.failures).toEqual([]);
      expect(report.unpaired).toBe(false);
    });
  },
);
