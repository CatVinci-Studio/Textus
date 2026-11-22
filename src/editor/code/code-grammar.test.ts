import { describe, expect, it } from "vitest";
import {
  LINE_LIMIT,
  compileGrammar,
  tokenizeBlock,
  tokenizeLine,
  unsafePattern,
} from "./code-grammar";

const grammar = (rules: unknown[], extra = {}) =>
  compileGrammar({ rules, ...extra }).grammar;

const shown = (g: ReturnType<typeof grammar>, line: string) =>
  tokenizeLine(g, line).map((t) => [line.slice(t.from, t.to), t.type]);

describe("a plugin's code grammar", () => {
  it("takes at each place the first rule matching there", () => {
    const g = grammar([
      { token: "string", match: '"[^"]*"' },
      { token: "comment", match: "!.*" },
      { token: "keyword", match: "\\b(?:permit|deny)\\b" },
    ]);
    // The ! inside the string is the string's; the one after is a comment.
    expect(shown(g, 'permit "a!b" ! note')).toEqual([
      ["permit", "keyword"],
      ['"a!b"', "string"],
      ["! note", "comment"],
    ]);
  });

  it("keeps ^ for the line's start and \\b for a word's edge", () => {
    const g = grammar([
      { token: "comment", match: "^\\s*!.*" },
      { token: "keyword", match: "\\bip\\b" },
    ]);
    expect(shown(g, "  ! a")).toEqual([["  ! a", "comment"]]);
    expect(shown(g, "x ! a")).toEqual([]);
    expect(shown(g, "ship ip")).toEqual([["ip", "keyword"]]);
  });

  it("reads case as the file's flags say, a rule's own flags first", () => {
    const g = grammar(
      [
        { token: "keyword", match: "interface" },
        { token: "number", match: "x", flags: "" },
      ],
      { flags: "i" },
    );
    expect(shown(g, "INTERFACE X x")).toEqual([
      ["INTERFACE", "keyword"],
      ["x", "number"],
    ]);
  });

  it("moves past a rule that matches nothing", () => {
    const g = grammar([
      { token: "keyword", match: "a*" },
      { token: "number", match: "\\d+" },
    ]);
    expect(shown(g, "b12a")).toEqual([
      ["12", "number"],
      ["a", "keyword"],
    ]);
  });

  it("leaves out a rule it can't use and says why, keeping the others", () => {
    const { grammar: g, problems } = compileGrammar({
      rules: [
        { token: "keyword", match: "(a+)+$" },
        { token: "weird", match: "x" },
        { token: "string", match: "(" },
        { token: "number", match: "\\d+" },
      ],
    });
    expect(g.rules).toHaveLength(1);
    expect(problems).toHaveLength(3);
    expect(compileGrammar({}).problems).toEqual(["rules isn't a list"]);
  });

  it("refuses patterns that can backtrack without end", () => {
    for (const bad of [
      "(a+)+$",
      "(?:a|ab)*c",
      "(x(?:y*))+",
      "(\\d{1,3}\\.)+",
      "(?:a?a?)+$",
      "(a)\\1",
      "(?<=a)b",
    ])
      expect(unsafePattern(bad), bad).not.toBeNull();
    for (const good of [
      "\\b(?:interface|vlan)\\b",
      "(?:\\d{1,3}\\.){3}\\d{1,3}",
      "[(+*)]+",
      "(?:ab)+",
      "\\(a+\\)+",
      "(?:a+?b)",
      "(?::\\d+)?",
    ])
      expect(unsafePattern(good), good).toBeNull();
  });

  it("leaves a line past the limit plain, and gives up on a slow line or block", () => {
    const g = grammar([{ token: "keyword", match: "a" }]);
    expect(tokenizeLine(g, "a".repeat(LINE_LIMIT + 1))).toEqual([]);
    expect(tokenizeBlock(g, "a\na")).toEqual([
      { from: 0, to: 1, type: "keyword" },
      { from: 2, to: 3, type: "keyword" },
    ]);
    // Each line's reading timed: one slow line is enough.
    let clock = 0;
    expect(tokenizeBlock(g, "a\na", () => (clock += 30))).toBeNull();
    // Quick lines, but too many of them.
    clock = 0;
    const lines = Array(60).fill("a").join("\n");
    expect(tokenizeBlock(g, lines, () => (clock += 10))).toBeNull();
    clock = 0;
    expect(tokenizeBlock(g, "a\na", () => (clock += 10))).toHaveLength(2);
  });
});
