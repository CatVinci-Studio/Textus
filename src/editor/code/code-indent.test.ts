import { describe, expect, it } from "vitest";
import { leadingWhitespaceOfLastLine } from "./code-indent";

describe("leadingWhitespaceOfLastLine", () => {
  it("returns the indentation of the last line", () => {
    expect(leadingWhitespaceOfLastLine("  const x = 1;")).toBe("  ");
    expect(leadingWhitespaceOfLastLine("if (x) {\n    return x;")).toBe("    ");
  });

  it("returns empty for an unindented line", () => {
    expect(leadingWhitespaceOfLastLine("const x = 1;")).toBe("");
    expect(leadingWhitespaceOfLastLine("")).toBe("");
  });

  it("only looks at the LAST line, ignoring earlier lines' indentation", () => {
    expect(leadingWhitespaceOfLastLine("    indented\nflush")).toBe("");
    expect(leadingWhitespaceOfLastLine("flush\n  indented")).toBe("  ");
  });

  it("supports tab indentation", () => {
    expect(leadingWhitespaceOfLastLine("\tconst x = 1;")).toBe("\t");
    expect(leadingWhitespaceOfLastLine("if (x) {\n\t\treturn x;")).toBe("\t\t");
  });

  it("stops at the first non-whitespace character", () => {
    expect(leadingWhitespaceOfLastLine("   x = 1;   ")).toBe("   ");
  });
});
