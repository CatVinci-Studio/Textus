import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import {
  EditorState,
  TextSelection,
  type Command,
} from "@milkdown/kit/prose/state";
import {
  backspaceIntoSource,
  clickOutsideBrackets,
  deleteIntoSource,
} from "./inline-source-plugin";

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
    wikilink: { group: "inline", inline: true, content: "text*", code: true },
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

describe("a click at a wikilink's brackets", () => {
  // "go ", then [[Note]] from 4 to 14.
  const linked = n.doc.create(null, [
    n.paragraph.create(null, [
      schema.text("go "),
      n.wikilink.create(null, schema.text("[[Note]]")),
    ]),
  ]);
  // `from`: the caret before the click, away from the link unless said.
  const caretAfter = (pos: number, pointer: boolean, from = 1) => {
    const start = EditorState.create({ schema, doc: linked });
    const state = start.apply(
      start.tr.setSelection(TextSelection.create(linked, from)),
    );
    const tr = state.tr.setSelection(TextSelection.create(linked, pos));
    if (pointer) tr.setMeta("pointer", true);
    const next = state.apply(tr);
    return clickOutsideBrackets([tr], state, next)?.selection.from ?? null;
  };

  it("lands outside the link, so what is typed next isn't part of it", () => {
    expect(caretAfter(13, true)).toBe(14);
    expect(caretAfter(5, true)).toBe(4);
  });

  it("at the name's ends while the brackets are hidden, lands outside too", () => {
    expect(caretAfter(11, true)).toBe(14);
    expect(caretAfter(7, true)).toBe(4);
    expect(caretAfter(11, true, 9)).toBeNull();
  });

  it("leaves a click within its name, and the arrow keys, alone", () => {
    expect(caretAfter(9, true)).toBeNull();
    expect(caretAfter(13, false)).toBeNull();
  });
});
