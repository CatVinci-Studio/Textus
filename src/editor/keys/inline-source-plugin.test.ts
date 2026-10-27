import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import {
  EditorState,
  TextSelection,
  type Command,
} from "@milkdown/kit/prose/state";
import { backspaceIntoSource, deleteIntoSource } from "./inline-source-plugin";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    link_source: {
      group: "inline",
      inline: true,
      content: "text*",
      code: true,
    },
    text: { group: "inline" },
  },
});
const n = schema.nodes;
// "see ", the link's source (2..18), " end".
const doc = n.doc.create(null, [
  n.paragraph.create(null, [
    schema.text("see "),
    n.link_source.create(null, schema.text("[Textus](a.com)")),
    schema.text(" end"),
  ]),
]);
const linkEnd = 1 + 4 + 17;

function run(command: Command, pos: number): string | null {
  let state = EditorState.create({ schema, doc });
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, pos)));
  let text: string | null = null;
  command(state, (tr) => (text = tr.doc.textContent));
  return text;
}

describe("Backspace and Delete beside a link's source", () => {
  it("take one character of the source, not the whole link", () => {
    expect(run(backspaceIntoSource, linkEnd)).toBe("see [Textus](a.com end");
    expect(run(deleteIntoSource, 5)).toBe("see Textus](a.com) end");
  });

  it("leave a caret beside plain text to the default", () => {
    expect(run(backspaceIntoSource, 5)).toBeNull();
    expect(run(deleteIntoSource, linkEnd)).toBeNull();
  });
});
