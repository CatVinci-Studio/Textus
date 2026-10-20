// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Schema, Slice } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { keepPastedSpans } from "./paste-markdown-plugin";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    md_span: {
      content: "inline*",
      group: "inline",
      inline: true,
      attrs: { rung: { default: 2 } },
    },
    md_code_span: { content: "text*", group: "inline", inline: true },
    text: { group: "inline" },
  },
});

const bold = (...text: string[]) =>
  schema.node(
    "md_span",
    null,
    text.map((t) => schema.text(t)),
  );
const italic = (text: string) =>
  schema.node("md_span", { rung: 1 }, [schema.text(text)]);
const code = (text: string) =>
  schema.node("md_code_span", null, [schema.text(text)]);

/** A selection at `pos` in "x" + `inside` + "y". */
function caretIn(inside: ReturnType<typeof bold> | null, pos: number) {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("x"),
      ...(inside ? [inside] : []),
      schema.text("y"),
    ]),
  ]);
  return TextSelection.create(EditorState.create({ doc }).doc, pos);
}

/** Pasted "**bold `code`** text **end**", opened as deep as it goes. */
const pasted = Slice.maxOpen(
  schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.node("md_span", null, [schema.text("bold "), code("code")]),
      schema.text(" text "),
      bold("end"),
    ]),
  ]).content,
);

describe("keepPastedSpans", () => {
  it("closes the spans at a paste's ends in a paragraph", () => {
    expect([pasted.openStart, pasted.openEnd]).toEqual([2, 2]);
    const slice = keepPastedSpans(pasted, caretIn(null, 2));
    expect([slice.openStart, slice.openEnd]).toEqual([1, 1]);
    expect(slice.content).toBe(pasted.content);
  });

  it("leaves a span open inside a span just like it", () => {
    // Pasted in the middle of bold: the bold at each end joins it.
    const slice = keepPastedSpans(pasted, caretIn(bold("ab"), 3));
    expect([slice.openStart, slice.openEnd]).toEqual([2, 2]);
  });

  it("closes a span inside a span of another kind", () => {
    const slice = keepPastedSpans(pasted, caretIn(italic("ab"), 3));
    expect([slice.openStart, slice.openEnd]).toEqual([1, 1]);
  });

  it("leaves a paste with no span at its ends as it was", () => {
    const plain = Slice.maxOpen(
      schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("a "),
          bold("b"),
          schema.text(" c"),
        ]),
      ]).content,
    );
    expect(keepPastedSpans(plain, caretIn(null, 2))).toBe(plain);
  });
});
