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

  it("keeps a # that ends the title's words, dropping only a closing run", () => {
    // A commented-out heading isn't one: Title still opens the document.
    expect(numberedHeadings("# Title\n<!--\n# Old\n-->\n## A")).toBe(
      "# Title {.unnumbered .unlisted}\n<!--\n# Old\n-->\n# A",
    );
    expect(numberedHeadings("# Learning C#\n\n## A")).toBe(
      "# Learning C# {.unnumbered .unlisted}\n\n# A",
    );
    expect(numberedHeadings("# Title ##\n\n## A")).toBe(
      "# Title {.unnumbered .unlisted}\n\n# A",
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
    // Code in a list item, and a fence that only closes on a bare run.
    expect(numberedHeadings("# T\n- x\n  ```\n  # not\n  ```\n## A")).toBe(
      "# T {.unnumbered .unlisted}\n- x\n  ```\n  # not\n  ```\n# A",
    );
    expect(numberedHeadings("---\n# draft\n---\n# A\n# B")).toBe(
      "---\n# draft\n---\n# A\n# B",
    );
    expect(numberedHeadings("# T\n```\n``` x\n# not\n```\n## A")).toBe(
      "# T {.unnumbered .unlisted}\n```\n``` x\n# not\n```\n# A",
    );
  });

  it("reads headings as the editor and Pandoc's CommonMark reader do", () => {
    // A fence an item opened ends with the item: `# not` is a heading
    // there, and `## A` is in the fence it opens.
    expect(numberedHeadings("# T\n- x\n  ```\n# not\n  ```\n## A")).toBe(
      "# T\n- x\n  ```\n# not\n  ```\n## A",
    );
    // Nothing in maths, an HTML block, a quote or a list item.
    expect(
      numberedHeadings(
        "# T\n\n$$\na\n=\n$$\n\n<div>\n# no\n</div>\n\n> # no\n\n- x\n\n  ## no\n\n## A",
      ),
    ).toBe(
      "# T {.unnumbered .unlisted}\n\n$$\na\n=\n$$\n\n<div>\n# no\n</div>\n\n> # no\n\n- x\n\n  ## no\n\n# A",
    );
  });

  it("numbers setext headings, written as ATX", () => {
    expect(numberedHeadings("Title\n=====\n\nA\n---\n\n### A1")).toBe(
      "# Title {.unnumbered .unlisted}\n\n# A\n\n## A1",
    );
    expect(numberedHeadings("A\nB\n===\n\nC\n===")).toBe("# A B\n\n# C");
  });
});
