// @vitest-environment jsdom
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  hashString,
  roundTripFile,
  type Failure,
  type FileReport,
} from "./save-roundtrip";

// The save round trip on the real-document corpus and this repository's own
// docs. Runs only when asked (`npm run test:roundtrip`).

const cache = join(process.cwd(), ".cache/roundtrip-corpus");
const enabled = process.env.ROUNDTRIP_CORPUS === "1";
const [shard, shards] = (process.env.ROUNDTRIP_SHARD ?? "1/1")
  .split("/")
  .map(Number);
const rounds = Number(process.env.ROUNDTRIP_ROUNDS ?? 1);

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

/** [id, path] of every file: the corpus, then our own Markdown. */
function corpusFiles(): [string, string][] {
  const files: [string, string][] = [];
  const manifest = join(cache, "manifest.json");
  if (existsSync(manifest)) {
    const { sources } = JSON.parse(readFileSync(manifest, "utf8")) as {
      sources: Record<string, { files: string[] }>;
    };
    for (const [name, source] of Object.entries(sources))
      for (const path of source.files)
        files.push([
          `${name}/${path.split("/").slice(2).join("/")}`,
          join(cache, path),
        ]);
  }
  const root = process.cwd();
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".md"))
        files.push([`textus/${path}`, join(root, path)]);
    }
  };
  walk("docs");
  walk("src/help");
  for (const name of readdirSync(root))
    if (name.endsWith(".md")) files.push([`textus/${name}`, join(root, name)]);
  return files.filter((_, i) => i % shards === shard - 1);
}

/**
 * Known losses, by file and edit: Markdown can't write what the editor holds
 * there, or the reading is ambiguous. Anything else fails.
 */
const UNCLOSED_HTML = "an unclosed <style> block runs to the end of the file";
const LIST_IN_ITEM =
  "micromark doesn't start a list at 2 as a new item's first line";
const NESTED_EMPHASIS = "emphasis directly inside emphasis of its kind";
const FLANKING = "bold starting with punctuation, glued to a word before it";
const RAGGED_TABLE =
  "a table with rows of different lengths is filled out when typed in, and undo keeps that";
const EMAIL_LIKE =
  "text that is no email address only for the character after it, until text is glued on";
const KNOWN: Record<string, string> = {
  "commonmark-spec/0175.md insert-heading": UNCLOSED_HTML,
  "gfm-spec/0142.md insert-heading": UNCLOSED_HTML,
  "commonmark-spec/0301.md add-list-item": LIST_IN_ITEM,
  "gfm-spec/0277.md add-list-item": LIST_IN_ITEM,
  "commonmark-spec/0371.md type-word": NESTED_EMPHASIS,
  "commonmark-spec/0375.md type-word": NESTED_EMPHASIS,
  "gfm-spec/0378.md type-word": NESTED_EMPHASIS,
  "commonmark-spec/0419.md toggle-bold": NESTED_EMPHASIS,
  "gfm-spec/0426.md toggle-bold": NESTED_EMPHASIS,
  "gfm-spec/0382.md type-word": NESTED_EMPHASIS,
  "gfm-spec/0204.md undo-edit": RAGGED_TABLE,
  "gfm-spec/0205.md undo-edit": RAGGED_TABLE,
  "commonmark-spec/0392.md type-word": FLANKING,
  "gfm-spec/0373.md type-word": FLANKING,
  "gfm-spec/0631.md type-word": EMAIL_LIKE,
  "gfm-spec/0631.md paste-markdown": EMAIL_LIKE,
};

const reports: Record<string, FileReport & { known: Failure[] }> = {};

describe.runIf(enabled)("the save round trip on the corpus", () => {
  const files = corpusFiles();
  it("has files to check (run scripts/roundtrip-corpus/fetch.mjs)", () => {
    expect(files.length).toBeGreaterThan(0);
  });
  it.each(files)(
    "%s",
    async (id, path) => {
      const report = await roundTripFile(
        readFileSync(path, "utf8"),
        hashString(id),
        rounds,
      );
      const isKnown = (failure: Failure) => `${id} ${failure.edit}` in KNOWN;
      const known = report.failures.filter(isKnown);
      const failures = report.failures.filter((f) => !isKnown(f));
      reports[id] = { ...report, failures, known };
      expect(failures).toEqual([]);
    },
    120_000,
  );
  afterAll(() => {
    const dir = join(cache, "report");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `shard-${shard}-of-${shards}.json`),
      JSON.stringify(reports),
    );
  });
});
