import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { createReadOnlyPlugin, readOnlyTr } from "./read-only-plugin";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: {},
  },
});

const start = () =>
  EditorState.create({
    schema,
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("kept")),
    ]),
    plugins: [createReadOnlyPlugin()],
  });

describe("a read-only document", () => {
  it("refuses every change to it, and takes them again once turned off", () => {
    const readOnly = start().apply(readOnlyTr(start(), true));
    const typed = readOnly.applyTransaction(readOnly.tr.insertText("x", 1));
    expect(typed.state.doc.textContent).toBe("kept");
    const open = readOnly.apply(readOnlyTr(readOnly, false));
    const again = open.applyTransaction(open.tr.insertText("x", 1));
    expect(again.state.doc.textContent).toBe("xkept");
  });

  it("still moves the selection", () => {
    const readOnly = start().apply(readOnlyTr(start(), true));
    const moved = readOnly.applyTransaction(
      readOnly.tr.setSelection(TextSelection.create(readOnly.doc, 3)),
    );
    expect(moved.state.selection.from).toBe(3);
  });
});
