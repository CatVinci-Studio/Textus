// @vitest-environment jsdom
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import { createTestEditor } from "../document-view/editor-test-harness";
import { documentMarkdown, serializeBlocks } from "../ai/doc-markdown";

// The live AI evaluation sends these documents to the model as the editor
// shows them, so each must come back byte-exact from opening it in the full
// editor and reading it the way the AI paths do.

// Resolved from the repository root (where vitest runs): import.meta.url
// is not a file URL under the jsdom environment.
const dir = join(process.cwd(), "src-tauri/src/ai/live_eval/docs");
const docs = readdirSync(dir).filter((name) => name.endsWith(".md"));

// The diagram preview renders asynchronously and would dispatch into a
// destroyed editor; it has nothing to do with the markdown.
vi.mock("mermaid", () => ({
  default: { initialize() {}, render: () => new Promise(() => {}) },
}));

// jsdom has no CSS.escape, which the code block's language picker uses.
const css = (globalThis.CSS ?? {}) as { escape?: (value: string) => string };
css.escape ??= (value) => value.replace(/["\\]/g, "\\$&");
(globalThis as { CSS?: unknown }).CSS = css;

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

async function asTheModelSeesIt(markdown: string): Promise<string> {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) =>
    documentMarkdown(serializeBlocks(ctx, ctx.get(editorViewCtx).state.doc)),
  );
}

describe("live-eval documents read exactly as the editor shows them", () => {
  it("has documents to check", () => {
    expect(docs.length).toBeGreaterThan(0);
  });
  it.each(docs)("%s", async (name) => {
    const source = readFileSync(join(dir, name), "utf8");
    const seen = await asTheModelSeesIt(source);
    // EVAL_DOCS_WRITE=1 rewrites a fixture to the editor's form (review
    // the diff before committing it).
    if (process.env.EVAL_DOCS_WRITE) writeFileSync(join(dir, name), seen);
    expect(seen).toBe(source);
  });
});
