import { describe, expect, it } from "vitest";
import { keepPastedLines } from "./paste-lines";

describe("keepPastedLines", () => {
  it("keeps the line breaks inside a pasted paragraph", () => {
    expect(keepPastedLines("Best,\nYouzhe")).toBe("Best,\\\nYouzhe");
    expect(keepPastedLines("One.\n\nTwo.")).toBe("One.\n\nTwo.");
  });

  it("leaves Markdown's blocks as they are", () => {
    const md =
      "# Title\nText\n- a\n- b\n\n```\nx\ny\n```\n| a | b |\n| - | - |";
    expect(keepPastedLines(md)).toBe(md);
  });

  it("makes a quote drawn with bars a Markdown quote", () => {
    const pasted =
      "▎ Hi Denisse,\n▎\n▎ I went through\n▎ your grading.\n▎\n▎ - T1: brief";
    expect(keepPastedLines(pasted)).toBe(
      "> Hi Denisse,\n>\n> I went through\\\n> your grading.\n>\n> - T1: brief",
    );
  });

  it("leaves a table's pipes alone", () => {
    expect(keepPastedLines("| a | b |\n| 1 | 2 |")).toBe(
      "| a | b |\n| 1 | 2 |",
    );
  });
});
