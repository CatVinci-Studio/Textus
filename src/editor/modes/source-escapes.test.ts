// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cursorCharRight, deleteCharBackward } from "@codemirror/commands";
import { sourceEscapes } from "./source-escapes";

let view: EditorView | null = null;
afterEach(() => view?.destroy());

const open = (doc: string) =>
  (view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, extensions: [sourceEscapes()] }),
  }));

it("shows a link destination's escapes as what they stand for", () => {
  const v = open("[Nov 8](Life/Nov%208.md) and 100%20 off");
  expect(v.contentDOM.textContent).toBe(
    "[Nov 8](Life/Nov 8.md) and 100%20 off",
  );
  expect(v.state.doc.toString()).toContain("Nov%208.md");
});

it("passes and deletes a run as one character", () => {
  const v = open("[x](a%20b.md)");
  v.dispatch({ selection: EditorSelection.cursor("[x](a".length) });
  cursorCharRight(v);
  expect(v.state.selection.main.head).toBe("[x](a%20".length);
  deleteCharBackward(v);
  expect(v.state.doc.toString()).toBe("[x](ab.md)");
});
