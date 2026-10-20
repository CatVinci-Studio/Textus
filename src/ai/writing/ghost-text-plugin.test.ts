import { describe, expect, it } from "vitest";
import { Schema, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import {
  completionContext,
  hasProse,
  isOneLineBlock,
  nextWordChunk,
  proseText,
  splitCandidates,
  stripEcho,
  tidySuggestion,
  typedThrough,
} from "./ghost-text-plugin";

describe("stripEcho", () => {
  it("drops a repeated tail of the before-text", () => {
    expect(stripEcho("The results show", "results show that it works")).toBe(
      " that it works",
    );
    expect(stripEcho("实验结果表明", "实验结果表明，该方法有效")).toBe(
      "，该方法有效",
    );
  });
  it("leaves short, ordinary overlaps alone", () => {
    expect(stripEcho("we saw the ", "the cat")).toBe("the cat");
    expect(stripEcho("Hello", " world")).toBe(" world");
  });
});

describe("nextWordChunk", () => {
  it("takes one word with its leading space", () => {
    expect(nextWordChunk(" quickly ballooned past")).toBe(" quickly");
    expect(nextWordChunk("ballooned.")).toBe("ballooned.");
  });
  it("takes up to two CJK characters plus trailing punctuation", () => {
    expect(nextWordChunk("应当先听取")).toBe("应当");
    expect(nextWordChunk("先，听取")).toBe("先，");
  });
});

describe("splitCandidates", () => {
  it("splits on the separator line and drops empties", () => {
    expect(splitCandidates("one\n<<<>>>\ntwo\n<<<>>>\n")).toEqual([
      "one",
      "two",
    ]);
    expect(splitCandidates("just one")).toEqual(["just one"]);
    expect(splitCandidates("one\n\n<<<>>>\n\ntwo")).toEqual(["one", "two"]);
  });
  it("cuts a separator that isn't on a line of its own", () => {
    expect(splitCandidates(" <<<>>>\n")).toEqual([]);
    expect(splitCandidates("<<<>>>\n slowed")).toEqual([" slowed"]);
    expect(splitCandidates(" grew <<<>>>\n slowed")).toEqual([
      " grew",
      " slowed",
    ]);
  });
  it("keeps each candidate's joining space", () => {
    expect(splitCandidates(" grew\n<<<>>>\n slowed\n<<<>>>\n stalled")).toEqual(
      [" grew", " slowed", " stalled"],
    );
  });
});

describe("one-line blocks", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "text*" },
      heading: { group: "block", content: "text*" },
      table: { group: "block", content: "row+", tableRole: "table" },
      row: { content: "cell+", tableRole: "row" },
      cell: { content: "paragraph", tableRole: "cell" },
      text: {},
    },
  });
  const p = (t: string) => schema.node("paragraph", null, schema.text(t));
  const doc = schema.node("doc", null, [
    p("prose"),
    schema.node("heading", null, schema.text("Title")),
    schema.node("table", null, [
      schema.node("row", null, [schema.node("cell", null, [p("cell")])]),
    ]),
  ]);

  it("knows a table cell and a heading from a paragraph", () => {
    expect(isOneLineBlock(doc, 3)).toBe(false);
    expect(isOneLineBlock(doc, 10)).toBe(true);
    expect(isOneLineBlock(doc, 19)).toBe(true);
  });

  it("joins a suggestion's lines there, and only there", () => {
    expect(tidySuggestion("Act", " walks.\n\nThen leaves.\n", true)).toBe(
      " walks. Then leaves.",
    );
    expect(tidySuggestion("Act", " walks.\n\nThen leaves.")).toBe(
      " walks.\n\nThen leaves.",
    );
  });
});

describe("the prose a completion reads its language from", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "inline*" },
      code_block: { group: "block", content: "text*", code: true },
      math_inline: {
        group: "inline",
        inline: true,
        atom: true,
        leafText: () => "x^2",
      },
      text: { group: "inline" },
    },
  });
  const p = (...content: ProseNode[]) =>
    schema.node("paragraph", null, content);
  const code = (t: string) => schema.node("code_block", null, schema.text(t));

  it("leaves out a diagram's source", () => {
    const doc = schema.node("doc", null, [
      code("graph TD\n  A[Start] --> B[End]"),
      p(),
    ]);
    const { before, prose } = completionContext(doc, doc.content.size - 1);
    expect(before).toContain("graph TD");
    expect(prose).toBe("");
    expect(hasProse(prose)).toBe(false);
  });

  it("keeps the paragraphs around it, without inline math", () => {
    const doc = schema.node("doc", null, [
      p(schema.text("流程如下")),
      code("graph TD\n  A --> B"),
      p(schema.text("面积 "), schema.node("math_inline"), schema.text(" 不变")),
    ]);
    const { prose } = completionContext(doc, doc.content.size - 1);
    expect(prose).toBe("流程如下\n\n面积  不变");
    expect(hasProse(prose)).toBe(true);
    expect(proseText(doc, 0, 3)).toBe("流程");
  });

  it("counts letters, not digits and punctuation, as prose", () => {
    expect(hasProse("1. -- 2026")).toBe(false);
    expect(hasProse("图")).toBe(true);
  });
});

describe("typing over a suggestion", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "paragraph+" },
      paragraph: { content: "text*" },
      text: {},
    },
  });
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("The plan")),
  ]);
  const end = doc.content.size - 1;
  // The caret at the suggestion, where typing puts its text.
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, end),
  });
  const ghost = {
    suggestion: " works well",
    candidates: [" works well", " fails", " worked"],
    index: 0,
    from: end,
  };

  it("narrows it while the typed text is its beginning", () => {
    const next = typedThrough(state.tr.insertText(" wo", end), ghost);
    expect(next?.suggestion).toBe("rks well");
    expect(next?.candidates).toEqual(["rks well", "rked"]);
    expect(next?.from).toBe(end + 3);
  });

  it("ends it on anything else", () => {
    // Other text, or the whole suggestion typed out.
    expect(typedThrough(state.tr.insertText(" x", end), ghost)).toBeNull();
    expect(
      typedThrough(state.tr.insertText(" works well", end), ghost),
    ).toBeNull();
    // Text going in elsewhere, or a deletion.
    expect(typedThrough(state.tr.insertText(" w", 1), ghost)).toBeNull();
    expect(typedThrough(state.tr.delete(end - 1, end), ghost)).toBeNull();
    // An IME's preedit isn't the suggestion's text; its commit can be.
    const zh = { ...ghost, suggestion: "很好", candidates: ["很好"] };
    expect(typedThrough(state.tr.insertText("hen", end), zh)).toBeNull();
    expect(typedThrough(state.tr.insertText("很", end), zh)?.suggestion).toBe(
      "好",
    );
  });
});
