// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { findFillSlots } from "./fill-slot-plugin";

let editor: Editor | undefined;
afterEach(async () => {
  await editor?.destroy();
  editor = undefined;
});

it("finds the blanks to fill, shows them as chips, and leaves code alone", async () => {
  editor = await createTestEditor(
    "展览将于【开幕日期】在【场馆】开幕。\n\n- 票务：【票务信息】\n\n`【不是空白】`\n\n【】不算。",
  );
  const view = editor.ctx.get(editorViewCtx);
  const slots = findFillSlots(view.state.doc);
  expect(slots.map((s) => s.label)).toEqual(["开幕日期", "场馆", "票务信息"]);
  for (const slot of slots)
    expect(view.state.doc.textBetween(slot.from, slot.to)).toBe(
      `【${slot.label}】`,
    );
  expect(
    [...view.dom.querySelectorAll(".fill-slot")].map((el) => el.textContent),
  ).toEqual(["【开幕日期】", "【场馆】", "【票务信息】"]);
});
