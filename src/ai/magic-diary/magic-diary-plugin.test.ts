import { Schema } from "@milkdown/kit/prose/model";
import { describe, expect, it } from "vitest";
import { absorbableLine } from "./magic-diary-plugin";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    heading: { group: "block", content: "text*" },
    blockquote: { group: "block", content: "block+" },
    code_block: { group: "block", content: "text*", code: true, marks: "" },
    list_item: { group: "block", content: "paragraph block*" },
    bullet_list: { group: "block", content: "list_item+" },
    table: { group: "block", content: "row+", tableRole: "table" },
    row: { content: "cell+", tableRole: "row" },
    cell: { content: "paragraph", tableRole: "cell" },
    text: {},
  },
});

const p = (t: string) =>
  schema.node("paragraph", null, t ? schema.text(t) : undefined);
const doc = (...blocks: ReturnType<typeof p>[]) =>
  schema.node("doc", null, blocks.length ? blocks : [p("")]);

/** Where the caret sits at the end of the first (and only) paragraph of a
 *  one-paragraph doc: `<doc><p>…</p></doc>` puts position 0 before the
 *  paragraph's opening token, so its text ends one past the content's own
 *  length. Every doc here is a single paragraph, which is what the plugin
 *  will absorb. */
const endOfFirst = (d: ReturnType<typeof doc>) => d.textContent.length + 1;

describe("absorbableLine", () => {
  it("takes the line the reader has just finished", () => {
    const d = doc(p("Ink dries faster than doubt."));
    const at = absorbableLine(d, endOfFirst(d));
    expect(at).not.toBeNull();
    expect(at?.line).toBe("Ink dries faster than doubt.");
    // The fade is an inline decoration over the characters themselves: the
    // reply is a widget inside this same paragraph, and fading the block
    // would take the answer down with it.
    expect(at?.textFrom).toBe(1);
    expect(at?.textTo).toBe(endOfFirst(d));
  });

  it("takes it in any script", () => {
    const d = doc(p("今晚先休息，还是继续写？"));
    expect(absorbableLine(d, endOfFirst(d))?.line).toBe(
      "今晚先休息，还是继续写？",
    );
  });

  it("ignores the whitespace a reader never meant to write", () => {
    const d = doc(p("  a line  "));
    expect(absorbableLine(d, endOfFirst(d))?.line).toBe("a line");
  });

  it("leaves a mid-paragraph caret alone", () => {
    // The gesture that opens the diary is finishing a sentence, which is a
    // caret at the end of one - not a paragraph split.
    const d = doc(p("Still going here"));
    expect(absorbableLine(d, 4)).toBeNull();
  });

  it("leaves an empty paragraph alone", () => {
    const d = doc(p(""));
    expect(absorbableLine(d, endOfFirst(d))).toBeNull();
    const spaces = doc(p("   "));
    expect(absorbableLine(spaces, endOfFirst(spaces))).toBeNull();
  });

  it("leaves a line too long to read as a line alone", () => {
    // Dissolving a whole paragraph reads as data loss, not as a trick.
    const d = doc(p("x".repeat(201)));
    expect(absorbableLine(d, endOfFirst(d))).toBeNull();
    const exactly = doc(p("x".repeat(200)));
    expect(absorbableLine(exactly, endOfFirst(exactly))).not.toBeNull();
  });

  it("leaves a caret outside the document alone rather than throwing", () => {
    const d = doc(p("a line"));
    expect(absorbableLine(d, -1)).toBeNull();
    expect(absorbableLine(d, d.content.size + 50)).toBeNull();
  });

  it("takes only what came after the last reply, so a conversation can go on", () => {
    // The paragraph has gone from one line to two, with the first turn's
    // reply sitting between them. `after` is where that first line ended.
    const d = doc(p("第一句。第二句。"));
    const after = 1 + "第一句。".length;
    expect(absorbableLine(d, endOfFirst(d), after)?.line).toBe("第二句。");
    // Without it, the whole paragraph is offered again - which would make
    // the page answer a line that was already answered.
    expect(absorbableLine(d, endOfFirst(d))?.line).toBe("第一句。第二句。");
  });

  it("starts the line from the top of the block when `after` points elsewhere", () => {
    const d = doc(p("只有这一行。"));
    // Past the end, before the start, or in another block entirely: all
    // three mean the marker is stale, and a stale marker must not eat the
    // beginning of the line.
    expect(absorbableLine(d, endOfFirst(d), 999)?.line).toBe("只有这一行。");
    expect(absorbableLine(d, endOfFirst(d), 0)?.line).toBe("只有这一行。");
    expect(absorbableLine(d, endOfFirst(d), -1)?.line).toBe("只有这一行。");
  });

  it("still refuses an empty follow-up line, so Enter stays Enter", () => {
    const d = doc(p("第一句。"));
    const after = 1 + "第一句。".length;
    // The reader answered themselves and pressed Enter with nothing new
    // written: there is no line for the page to take.
    expect(absorbableLine(d, after, after)).toBeNull();
  });

  it("only takes a plain paragraph", () => {
    const heading = schema.node("doc", null, [
      schema.node("heading", null, schema.text("A heading")),
    ]);
    expect(absorbableLine(heading, heading.textContent.length + 1)).toBeNull();

    const quoted = schema.node("doc", null, [
      schema.node("blockquote", null, [p("quoted")]),
    ]);
    expect(absorbableLine(quoted, quoted.textContent.length + 3)).toBeNull();

    const code = schema.node("doc", null, [
      schema.node("code_block", null, schema.text("const a = 1;")),
    ]);
    expect(absorbableLine(code, code.textContent.length + 3)).toBeNull();

    const item = schema.node("doc", null, [
      schema.node("bullet_list", null, [
        schema.node("list_item", null, [p("item")]),
      ]),
    ]);
    expect(absorbableLine(item, item.textContent.length + 5)).toBeNull();

    const cell = schema.node("doc", null, [
      schema.node("table", null, [
        schema.node("row", null, [schema.node("cell", null, [p("cell")])]),
      ]),
    ]);
    expect(absorbableLine(cell, cell.textContent.length + 7)).toBeNull();
  });
});
