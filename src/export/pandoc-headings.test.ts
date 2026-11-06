import { describe, expect, it } from "vitest";
import { numberedHeadings } from "./pandoc-headings";

describe("numbered headings for Pandoc", () => {
  it("leaves a lone title unnumbered and numbers from the level below, as Heading Numbers does", () => {
    expect(
      numberedHeadings("# Title\n\n## A\n\n### A1\n\n## B\n\n#### deep"),
    ).toBe(
      "# Title {.unnumbered .unlisted}\n\n# A\n\n## A1\n\n# B\n\n### deep",
    );
  });

  it("numbers every heading of the top level when there are several", () => {
    expect(numberedHeadings("## A\n### a\n## B")).toBe("# A\n## a\n# B");
    expect(numberedHeadings("# A\n# B")).toBe("# A\n# B");
  });

  it("does not take a code line for a heading", () => {
    expect(numberedHeadings("# T\n```\n# not\n```\n## A")).toBe(
      "# T {.unnumbered .unlisted}\n```\n# not\n```\n# A",
    );
  });
});
