// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import {
  createEditorInputPlugin,
  releaseKeys,
  runEditorOp,
  setKeyCapture,
} from "./editor-input";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block", toDOM: () => ["p", 0] },
    text: {},
  },
});

/** An editor holding "alpha|" whose keys the plugin "p" has, one just pressed. */
function heldEditor() {
  const plugin = createEditorInputPlugin();
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("alpha")),
  ]);
  const view = new EditorView(document.createElement("div"), {
    state: EditorState.create({
      doc,
      plugins: [plugin],
      selection: TextSelection.create(doc, 6),
    }),
  });
  setKeyCapture("p", { mode: "all", keys: [] }, () => {});
  plugin.props.handleKeyDown!.call(
    plugin,
    view,
    new KeyboardEvent("keydown", { key: "j" }),
  );
  return view;
}

const writeText = vi.fn(() => Promise.resolve());

afterEach(() => {
  releaseKeys("p");
  writeText.mockClear();
  vi.unstubAllGlobals();
});

it("deleteChars copies what it takes, unless told not to", () => {
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const view = heldEditor();
  expect(runEditorOp("p", { op: "deleteChars", back: true }).text).toBe("a");
  expect(writeText).toHaveBeenCalledWith("a");
  writeText.mockClear();
  runEditorOp("p", { op: "deleteChars", back: true, copy: false });
  expect(writeText).not.toHaveBeenCalled();
  expect(view.state.doc.textContent).toBe("alp");
  view.destroy();
});
