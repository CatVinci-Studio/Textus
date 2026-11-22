import { describe, expect, it } from "vitest";
import { whyNotDrawn } from "./mermaid-plugin";

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
