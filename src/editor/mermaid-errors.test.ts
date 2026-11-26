import { describe, expect, it } from "vitest";
import { failureNote, whyNotDrawn } from "./mermaid-plugin";

describe("why a diagram wasn't drawn", () => {
  it("keeps the renderer's first lines", () => {
    const parse = new Error(
      "Parse error on line 3:\n...A --> B  A -->\n-----------------^\nExpecting 'AMP', got 'EOF'",
    );
    expect(whyNotDrawn(parse)).toBe(parse.message);
    expect(whyNotDrawn(new Error("a\nb\nc\nd\ne\nf\ng\nh"))).toBe(
      "a\nb\nc\nd\ne\nf",
    );
  });

  it("is short, and empty when nothing says why", () => {
    expect(whyNotDrawn(new Error("x".repeat(900)))).toHaveLength(601);
    expect(whyNotDrawn({})).toBe("");
    expect(whyNotDrawn("Lexical error")).toBe("Lexical error");
  });
});

describe("the note under a diagram that couldn't be drawn", () => {
  it("shows whenever it failed, even with nothing said why", () => {
    expect(failureNote("graph", 9, "")).toHaveLength(1);
    expect(failureNote("graph", 9, "Parse error")).toHaveLength(1);
    expect(failureNote("graph", 9, undefined)).toHaveLength(0);
  });
});
