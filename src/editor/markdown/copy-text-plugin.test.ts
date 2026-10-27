import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { codeTextOf } from "./copy-text-plugin";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    code_block: { group: "block", content: "text*", code: true },
    md_code_span: {
      group: "inline",
      inline: true,
      content: "text*",
      code: true,
    },
    text: { group: "inline" },
  },
});
const n = schema.nodes;
const doc = n.doc.create(null, [
  n.paragraph.create(null, [
    schema.text("a "),
    n.md_code_span.create(null, schema.text("span")),
  ]),
  n.code_block.create(null, schema.text("let x;\nlet y;")),
]);

describe("codeTextOf", () => {
  it("is the code, as written, for a copy inside a code block", () => {
    // As a copy cuts it: with the parents it is inside.
    const start = doc.child(0).nodeSize + 1;
    expect(codeTextOf(doc.slice(start + 4, start + 10, true))).toBe("x;\nlet");
  });

  it("is the code inside inline code", () => {
    expect(codeTextOf(doc.slice(5, 8, true))).toBe("pan");
  });

  it("is null for a copy that reaches outside the code", () => {
    expect(codeTextOf(doc.slice(1, 8, true))).toBeNull();
    expect(codeTextOf(doc.slice(0, doc.content.size))).toBeNull();
  });
});
