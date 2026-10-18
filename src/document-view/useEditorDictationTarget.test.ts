// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { createTestEditor } from "./editor-test-harness";
import type { EditorRunner } from "../editor/useEditorRunner";
vi.mock("../voice/dictation-target", () => ({
  registerDictationTarget: vi.fn(),
}));
import { captureEditorDictation } from "./useEditorDictationTarget";
let editor: Editor | undefined;
afterEach(async () => {
  cleanup();
  await editor?.destroy();
  editor = undefined;
});
it("replaces only the captured range and its partial transcript using plain text", async () => {
  editor = await createTestEditor("Before target after.");
  const run: EditorRunner = (fn) => editor!.action(fn);
  run((ctx) => {
    const v = ctx.get(editorViewCtx);
    v.dispatch(
      v.state.tr.setSelection(TextSelection.create(v.state.doc, 8, 14)),
    );
  });
  const session = captureEditorDictation(run)!;
  expect(session.apply("partial")).toBe(true);
  expect(session.apply("**spoken**")).toBe(true);
  run((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc;
    expect(doc.textContent).toBe("Before **spoken** after.");
    doc.descendants((node) => {
      if (node.isText) expect(node.marks).toHaveLength(0);
    });
  });
  session.finish();
  expect(session.apply("late")).toBe(false);
});
it("preserves manual edits and rejects late dictation", async () => {
  editor = await createTestEditor("Original.");
  const run: EditorRunner = (fn) => editor!.action(fn);
  const session = captureEditorDictation(run)!;
  expect(session.apply("Speech ")).toBe(true);
  run((ctx) => {
    const v = ctx.get(editorViewCtx);
    v.dispatch(v.state.tr.insertText("Manual ", 1));
  });
  expect(session.apply("Late speech")).toBe(false);
  expect(run((ctx) => ctx.get(editorViewCtx).state.doc.textContent)).toContain(
    "Manual ",
  );
});
it("rejects dictation when the caret moves away from the captured target", async () => {
  editor = await createTestEditor("Original.");
  const run: EditorRunner = (fn) => editor!.action(fn);
  const session = captureEditorDictation(run)!;
  run((ctx) => {
    const v = ctx.get(editorViewCtx);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 5)));
  });
  expect(session.apply("Late speech")).toBe(false);
  expect(run((ctx) => ctx.get(editorViewCtx).state.doc.textContent)).toBe(
    "Original.",
  );
});
