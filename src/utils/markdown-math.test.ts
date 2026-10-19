import { describe, expect, it } from "vitest";
import { normalizeMathDelimiters } from "./markdown-math";

describe("normalizeMathDelimiters (AI replies and pastes)", () => {
  it.each([
    ["inline", "so \\(x^2\\) holds", "so $x^2$ holds"],
    ["display inside a line", "so \\[x\\] holds", "so $$x$$ holds"],
    ["display alone on a line", "\\[x = 1\\]", "$$\nx = 1\n$$"],
    [
      "display on lines of its own",
      "a\n\n\\[\nx = 1\n\\]\n",
      "a\n\n$$\nx = 1\n$$\n",
    ],
    ["two displays on one line", "\\[a\\] and \\[b\\]", "$$a$$ and $$b$$"],
  ])("converts %s to dollars", (_name, text, converted) => {
    expect(normalizeMathDelimiters(text)).toBe(converted);
  });

  it.each([
    ["a citation", "see \\[1\\]"],
    ["a citation list", "see \\[2, 3\\] and \\[4-6\\]"],
    ["a citation alone on a line", "\\[12\\]"],
    ["a fenced code block", "```\n\\(x\\)\n```"],
  ])("leaves %s alone", (_name, text) => {
    expect(normalizeMathDelimiters(text)).toBe(text);
  });
});
