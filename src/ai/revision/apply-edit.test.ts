// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import { createTestEditor } from "../../document-view/editor-test-harness";
import {
  readSourceBlocks,
  writePreservingSource,
} from "../../editor/markdown/source-preserving";
import { applyEditRange } from "./apply-edit";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

describe("an AI edit accepted into one paragraph", () => {
  it("leaves the rest of the file as written", async () => {
    const markdown =
      "Notes\n=====\n\nFirst _one_ with snake_case.\n\nSecond paragraph.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    const editor = await createTestEditor(markdown);
    editors.push(editor);
    const saved = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { doc } = view.state;
      const source = readSourceBlocks(ctx, markdown, doc)!;
      // The second paragraph's text, as an accepted proposal replaces it.
      const from = doc.child(0).nodeSize + doc.child(1).nodeSize + 1;
      const to = from + doc.child(2).content.size;
      expect(doc.textBetween(from, to)).toBe("Second paragraph.");
      view.dispatch(
        applyEditRange(view.state, ctx, from, to, "A _new_ second one."),
      );
      return writePreservingSource(ctx, source, view.state.doc);
    });
    expect(saved).toBe(
      "Notes\n=====\n\nFirst _one_ with snake_case.\n\nA *new* second one.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n",
    );
  });
});
