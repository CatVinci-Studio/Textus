import { describe, expect, it } from "vitest";
import {
  defaultMarkdownFilename,
  firstContentLine,
  firstLevelOneHeading,
  markdownFilename,
} from "./save-default-name";

describe("firstLevelOneHeading", () => {
  it("uses the first H1 rather than a lower-level heading", () => {
    expect(firstLevelOneHeading("## Intro\n\n# Main title\n\n# Later")).toBe(
      "Main title",
    );
  });

  it("supports setext H1 headings and removes inline Markdown", () => {
    expect(
      firstLevelOneHeading("**A [useful](https://x.test) title**\n==="),
    ).toBe("A useful title");
  });

  it("ignores headings inside fenced code", () => {
    expect(firstLevelOneHeading("```md\n# Fake\n```\n# Real")).toBe("Real");
    expect(firstLevelOneHeading("<!--\n# Old title\n-->\n# Real title")).toBe(
      "Real title",
    );
  });
});

describe("firstContentLine", () => {
  it("falls back to the first non-empty body line and removes block markers", () => {
    expect(firstContentLine("\n\n> - **Opening thought** for today")).toBe(
      "Opening thought for today",
    );
  });

  it("uses a lower-level heading without its heading markers", () => {
    expect(firstContentLine("## Section name\n\nBody")).toBe("Section name");
  });

  it("skips comments the way the editor does, not a `<!--` inside code", () => {
    expect(firstContentLine("```\n<!--\n```\nBody")).toBe("Body");
    expect(firstContentLine("<!--\nhidden\n-->\nShown")).toBe("Shown");
    expect(firstContentLine("- - -\n    <!-- note\nShown")).toBe("Shown");
  });

  it("reads past a front matter left open instead of skipping the whole document", () => {
    expect(firstContentLine("---\nNotes about harbours\n")).toBe(
      "Notes about harbours",
    );
  });

  it("skips frontmatter, comments, rules, and fenced code", () => {
    expect(
      firstContentLine(
        "---\ntitle: Metadata\n---\n<!-- note -->\n***\n```\ncode\n```\nActual first line",
      ),
    ).toBe("Actual first line");
  });
});

describe("markdownFilename", () => {
  it("removes characters that are invalid on common desktop systems", () => {
    expect(markdownFilename("Roadmap: Q3/Q4? *Draft*", "Untitled")).toBe(
      "Roadmap- Q3-Q4- -Draft-.md",
    );
  });

  it("avoids duplicate extensions and reserved Windows names", () => {
    expect(markdownFilename("notes.md", "Untitled")).toBe("notes.md");
    expect(markdownFilename("CON", "Untitled")).toBe("_CON.md");
  });

  it("honours the setting switch", () => {
    expect(defaultMarkdownFilename("# Named", "Untitled", true)).toBe(
      "Named.md",
    );
    expect(defaultMarkdownFilename("# Named", "Untitled", false)).toBe(
      "Untitled.md",
    );
  });

  it("uses the first content line when there is no H1", () => {
    expect(
      defaultMarkdownFilename("First **draft** line", "Untitled", true),
    ).toBe("First draft line.md");
  });
});
