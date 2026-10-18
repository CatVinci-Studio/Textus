// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { createTestEditor } from "./editor-test-harness";
import type { EditorRunner } from "../editor/useEditorRunner";
import { useReadAloudTarget } from "./useReadAloudTarget";

let editor: Editor | undefined;
afterEach(async () => {
  cleanup();
  await editor?.destroy();
  editor = undefined;
});
it("defaults to the whole document even when text is selected", async () => {
  editor = await createTestEditor("Before.\n\nSelected words.\n\nAfter.");
  const run: EditorRunner = (fn) => editor!.action(fn);
  run((ctx) => {
    const v = ctx.get(editorViewCtx);
    v.dispatch(
      v.state.tr.setSelection(TextSelection.create(v.state.doc, 10, 18)),
    );
  });
  const { result } = renderHook(() => useReadAloudTarget(run));
  expect(result.current.getText()).toBe("Before.\n\nSelected words.\n\nAfter.");
  expect(result.current.getText("selection")).toBe("Selected");
});
it("uses an explicit range immediately and guards text after a document edit", async () => {
  editor = await createTestEditor("Before.\n\nSelected words.\n\nAfter.");
  const run: EditorRunner = (fn) => editor!.action(fn);
  run((ctx) => {
    const v = ctx.get(editorViewCtx);
    v.dispatch(
      v.state.tr.setSelection(TextSelection.create(v.state.doc, 10, 24)),
    );
  });
  const { result } = renderHook(() => useReadAloudTarget(run));
  act(() => {
    result.current.setRange("selection");
    expect(result.current.getText("selection")).toBe("Selected words");
  });
  const chunk = { text: "Selected words", start: 0, end: 14, paragraph: 0 };
  act(() => expect(result.current.highlight(chunk)).toBe(true));
  act(() =>
    run((ctx) => {
      const v = ctx.get(editorViewCtx);
      v.dispatch(v.state.tr.insertText("Change", 1));
    }),
  );
  act(() => expect(result.current.highlight(chunk)).toBe(false));
});
