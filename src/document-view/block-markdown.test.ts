// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import { createTestEditor } from "./editor-test-harness";
import { serializeBlocks } from "../ai/doc-markdown";
import { blockMarkdown } from "../editor/markdown/block-markdown";

let editor: Editor | null = null;
afterEach(async () => {
  await editor?.destroy();
  editor = null;
});

describe("blockMarkdown", () => {
  it("writes a block as the serializer writes a document of it alone", async () => {
    editor = await createTestEditor(
      "# Title\n\n- a\n- b\n\n***\n\n_em_ text\n",
    );
    editor.action((ctx) => {
      const { doc } = ctx.get(editorViewCtx).state;
      doc.forEach((node, pos) =>
        expect(blockMarkdown(ctx, node)).toBe(
          ctx.get(serializerCtx)(doc.cut(pos, pos + node.nodeSize)),
        ),
      );
    });
  });

  it("serializes only the block an edit touched again", async () => {
    editor = await createTestEditor("one\n\ntwo\n\nthree\n");
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      serializeBlocks(ctx, view.state.doc);
      view.dispatch(view.state.tr.insertText("!", 2));
      const serialize = ctx.get(serializerCtx);
      const spy = vi.fn(serialize);
      ctx.set(serializerCtx, spy);
      const blocks = serializeBlocks(ctx, view.state.doc);
      ctx.set(serializerCtx, serialize);
      expect(blocks.map((b) => b.markdown)).toEqual(["o!ne", "two", "three"]);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
