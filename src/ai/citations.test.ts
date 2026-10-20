import { describe, expect, it } from "vitest";
import {
  citationsAsFootnotes,
  footnoteLabels,
  hasCitations,
  withoutCitations,
} from "./citations";

const proposal =
  "Spring tides are highest [1](https://sea.example/tides), twice a month [2](https://moon.example/#phases) and at new moon [1](https://sea.example/tides/).";

describe("proposal citations", () => {
  it("are found only in the [n](url) form", () => {
    expect(hasCitations(proposal)).toBe(true);
    expect(
      hasCitations("Step [1] of 3, see [the docs](https://x.example)"),
    ).toBe(false);
  });

  it("are left out without a trace when footnotes are off", () => {
    expect(withoutCitations(proposal)).toBe(
      "Spring tides are highest, twice a month and at new moon.",
    );
  });

  it("become footnotes numbered on from the document's, one per page", () => {
    const { text, definitions } = citationsAsFootnotes(
      proposal,
      [{ n: 1, url: "https://sea.example/tides", title: "Tide [tables]" }],
      footnoteLabels("Earlier.[^1] And.[^2]\n\n[^1]: a\n[^2]: b"),
    );
    expect(text).toBe(
      "Spring tides are highest[^3], twice a month[^4] and at new moon[^3].",
    );
    expect(definitions).toEqual([
      "[^3]: [Tide tables](https://sea.example/tides)",
      "[^4]: [moon.example](https://moon.example/#phases)",
    ]);
  });
});
