import { describe, expect, it } from "vitest";
import { normalizeMathDelimiters } from "./markdown-math";

describe("normalizeMathDelimiters (AI replies and pastes)", () => {
  it.each([
    ["inline", "so \\(x^2\\) holds", "so $x^2$ holds"],
    ["display inside a line", "so \\[x^2\\] holds", "so $$x^2$$ holds"],
    ["display alone on a line", "\\[x = 1\\]", "$$\nx = 1\n$$"],
    [
      "display on lines of its own",
      "a\n\n\\[\nx = 1\n\\]\n",
      "a\n\n$$\nx = 1\n$$\n",
    ],
    [
      "two displays on one line",
      "\\[a_1\\] and \\[b_1\\]",
      "$$a_1$$ and $$b_1$$",
    ],
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

describe("\\[…\\] as maths only when it looks like LaTeX", () => {
  it.each([
    ["see \\[optional\\] here", "see \\[optional\\] here"],
    ["\\[x\\]", "\\[x\\]"],
    ["cite \\[1\\]", "cite \\[1\\]"],
    ["so \\[a^2 + b\\]", "so $$a^2 + b$$"],
    ["so \\[\\frac{a}{b}\\]", "so $$\\frac{a}{b}$$"],
  ])("reads %j", (source, expected) => {
    expect(normalizeMathDelimiters(source)).toBe(expected);
  });
});
