// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../../document-view/editor-test-harness";

vi.mock("mermaid", () => ({
  default: { initialize() {}, render: () => new Promise(() => {}) },
}));
const css = (globalThis.CSS ?? {}) as { escape?: (value: string) => string };
css.escape ??= (value) => value.replace(/["\\]/g, "\\$&");
(globalThis as { CSS?: unknown }).CSS = css;
// jsdom has none; view.pasteText only needs the type.
(globalThis as { ClipboardEvent?: unknown }).ClipboardEvent ??= class extends (
  Event
) {};

let editor: Editor | null = null;
afterEach(async () => {
  await editor?.destroy();
  editor = null;
});

async function viewOf(markdown: string): Promise<EditorView> {
  editor = await createTestEditor(markdown);
  const view = editor.ctx.get(editorViewCtx);
  const end = view.state.doc.content.size - 1;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, end)),
  );
  return view;
}

const type = (view: EditorView, text: string) =>
  view.dispatch(view.state.tr.insertText(text));
const undoOnce = (view: EditorView) => undo(view.state, view.dispatch);

it("takes back one paste of several quick ones", async () => {
  const view = await viewOf("Start");
  view.pasteText(" one");
  view.pasteText(" two");
  view.pasteText(" three");
  undoOnce(view);
  expect(view.state.doc.textContent).toBe("Start one two");
  undoOnce(view);
  expect(view.state.doc.textContent).toBe("Start one");
});

it("keeps typing apart from the paste before it, and still folds typing", async () => {
  const view = await viewOf("Start");
  type(view, " a");
  type(view, "b");
  view.pasteText(" pasted");
  type(view, " c");
  type(view, "d");
  undoOnce(view);
  expect(view.state.doc.textContent).toBe("Start ab pasted");
  undoOnce(view);
  expect(view.state.doc.textContent).toBe("Start ab");
  undoOnce(view);
  expect(view.state.doc.textContent).toBe("Start");
});

it("takes back a cut on its own", async () => {
  const view = await viewOf("Start");
  type(view, " typed");
  const end = view.state.selection.from;
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, end - 2, end))
      .deleteSelection()
      .setMeta("uiEvent", "cut"),
  );
  expect(view.state.doc.textContent).toBe("Start typ");
  undoOnce(view);
  expect(view.state.doc.textContent).toBe("Start typed");
});
