// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { imageCaptionAt } from "./image-plugin";

let editor: Editor | undefined;
afterEach(async () => {
  await editor?.destroy();
  editor = undefined;
});

function imagePositions(view: {
  state: { doc: import("@milkdown/kit/prose/model").Node };
}) {
  const found: number[] = [];
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === "image") found.push(pos);
    return true;
  });
  return found;
}

it("reads a picture's caption from the emphasis line under it, and draws it as one", async () => {
  editor = await createTestEditor(
    "![石雕](a.jpg)\n\n*“美洲豹”单元氛围参考图*\n\n正文，*不是*图注。\n\n![无图注](b.jpg)\n\n普通段落。",
  );
  const view = editor.ctx.get(editorViewCtx);
  const [first, second] = imagePositions(view);
  expect(imageCaptionAt(view.state.doc, first)).toBe("“美洲豹”单元氛围参考图");
  expect(imageCaptionAt(view.state.doc, second)).toBe("");
  const captions = [...view.dom.querySelectorAll("p.image-caption")].map(
    (p) => p.textContent,
  );
  expect(captions).toEqual(["“美洲豹”单元氛围参考图"]);
});
