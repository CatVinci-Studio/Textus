import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { computeMatches } from "./find-replace-plugin";
import { expandReplacement } from "./find-query";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "inline*" },
    md_span: { content: "inline*", inline: true, group: "inline" },
    text: { group: "inline" },
  },
});
const span = (text: string) => schema.node("md_span", null, schema.text(text));
const doc = schema.node(
  "doc",
  null,
  schema.node("paragraph", null, [
    schema.text("before"),
    span("bold"),
    schema.text("after"),
  ]),
);

describe("search across inline enclosure boundaries", () => {
  it.each(["before", "bold", "after"])(
    "replaces %s without consuming neighboring node tokens",
    (query) => {
      const { matches } = computeMatches(doc, query, false, false);
      expect(matches).toHaveLength(1);
      const match = matches[0];
      expect(match.to - match.from).toBe(query.length);
      const state = EditorState.create({ doc });
      const changed = state.apply(
        state.tr.insertText("NEW", match.from, match.to),
      ).doc;
      expect(changed.firstChild?.childCount).toBe(3);
      expect(changed.firstChild?.child(1).type.name).toBe("md_span");
      expect(changed.textContent).toBe(doc.textContent.replace(query, "NEW"));
    },
  );
  it("rejects invalid regex and terminates on zero-width matches", () => {
    expect(computeMatches(doc, "[", false, true).error).toBe(true);
    const result = computeMatches(doc, "(?=o)", false, true);
    expect(result.matches.length).toBe(2);
    expect(result.matches.every((match) => match.from === match.to)).toBe(true);
  });
});

describe("regex replace", () => {
  it("writes out what each match captured where it was found, lookarounds too", () => {
    const text = schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("price: 10 USD, 20 USD")),
    ]);
    const { matches } = computeMatches(text, "(?<=: )(\\d+) USD", false, true);
    expect(matches).toHaveLength(1);
    expect(expandReplacement("$$$1 ($&)", matches[0])).toBe("$10 (10 USD)");
    const named = computeMatches(text, "(?<n>\\d+) USD", false, true).matches;
    expect(named.map((m) => expandReplacement("<$<n>>", m))).toEqual([
      "<10>",
      "<20>",
    ]);
  });
});
