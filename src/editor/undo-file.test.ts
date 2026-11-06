// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import {
  closeHistory,
  history,
  redo,
  undo,
  undoDepth,
} from "@milkdown/kit/prose/history";
import { EditorState } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";

vi.mock("../platform/ipc-files", () => ({ undoFiles: {} }));

import { captureHistory, docHash, restoreHistory } from "./undo-file";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block", toDOM: () => ["p", 0] },
    text: {},
  },
});

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((v) => v.destroy()));

function editor(text: string) {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text(text)),
  ]);
  const view = new EditorView(document.createElement("div"), {
    state: EditorState.create({ doc, plugins: [history()] }),
  });
  views.push(view);
  return view;
}

/** Types `text` at the end as one undo step. */
function type(view: EditorView, text: string) {
  const end = view.state.doc.content.size - 1;
  view.dispatch(closeHistory(view.state.tr.insertText(text, end)));
}

const text = (view: EditorView) => view.state.doc.textContent;

it("gives a new editor the same undo steps over the same text", () => {
  const before = editor("One");
  type(before, " two");
  type(before, " three");
  const kept = JSON.parse(JSON.stringify(captureHistory(before.state)));
  // The editor that was kept from is left as it was.
  expect(text(before)).toBe("One two three");
  expect(undoDepth(before.state)).toBe(2);

  const after = editor("One two three");
  expect(docHash(after.state.doc)).toBe(docHash(before.state.doc));
  expect(restoreHistory(after, kept)).toBe(true);
  expect(text(after)).toBe("One two three");
  expect(undoDepth(after.state)).toBe(2);
  undo(after.state, after.dispatch);
  expect(text(after)).toBe("One two");
  undo(after.state, after.dispatch);
  expect(text(after)).toBe("One");
  redo(after.state, after.dispatch);
  expect(text(after)).toBe("One two");
});

it("knows other text by its hash, and leaves an editor the history can't fit", () => {
  const before = editor("One");
  type(before, " two and more");
  const kept = captureHistory(before.state);
  const other = editor("A");
  expect(docHash(other.state.doc)).not.toBe(docHash(before.state.doc));
  expect(restoreHistory(other, kept)).toBe(false);
  expect(text(other)).toBe("A");
  expect(undoDepth(other.state)).toBe(0);
});
