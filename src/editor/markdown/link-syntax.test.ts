import { describe, expect, it } from "vitest";
import { fromMarkdown } from "mdast-util-from-markdown";
import { labelParts } from "./link-label";
import {
  encodeDestSpaces,
  encodedRuns,
  hiddenLinkParts,
  inlinedReference,
  linkHref,
  parseLink,
  splitAroundLink,
} from "./link-syntax";

describe("parseLink", () => {
  it.each([
    ['[a [b] c](u "t")', "inline", "u", "t"],
    ["[a](<my file.md>)", "inline", "my file.md", ""],
    ["[a](u(1))", "inline", "u(1)", ""],
    ["[a `]` b](u)", "inline", "u", ""],
    ["[a\\]b][ref]", "reference", "ref", ""],
    ["[a][]", "reference", "a", ""],
    ["<https://x.org>", "autolink", "https://x.org", ""],
    ["https://x.org/a", "bare", "https://x.org/a", ""],
  ])("reads %s", (text, kind, dest, title) => {
    expect(parseLink(text)).toMatchObject({ kind, dest, title });
  });

  it.each(["[a](u(1)) ", "[a](u", "a [b](c)", "[a]("])(
    "reads %s as no one link",
    (text) => {
      expect(parseLink(text)).toBeNull();
    },
  );
});

describe("hiddenLinkParts", () => {
  it("hides the brackets and everything after the label", () => {
    expect(hiddenLinkParts("[a [b] c](u 't')")).toEqual([
      [0, 1],
      [8, 16],
    ]);
    expect(hiddenLinkParts("[a][ref]")).toEqual([
      [0, 1],
      [2, 8],
    ]);
  });

  it("hides an autolink's angle brackets and nothing of a bare URL", () => {
    expect(hiddenLinkParts("<https://x.org>")).toEqual([
      [0, 1],
      [14, 15],
    ]);
    expect(hiddenLinkParts("https://x.org")).toEqual([]);
  });

  it("shows an empty label's URL, and all of what is no link", () => {
    expect(hiddenLinkParts('[](u "t")')).toEqual([
      [0, 3],
      [4, 9],
    ]);
    expect(hiddenLinkParts("[a](u")).toBeNull();
    expect(hiddenLinkParts("[a](u) b")).toBeNull();
  });
});

describe("linkHref", () => {
  it("reads every kind, a reference against the definitions", () => {
    const defs = () => ['[Ref Label]: <https://r.org/a b> "T"'];
    expect(linkHref("[a](u\\)v)")).toBe("u)v");
    expect(linkHref("[a][ref  label]", defs)).toBe("https://r.org/a b");
    expect(linkHref("[a][none]", defs)).toBeNull();
    expect(linkHref("<a@b.org>")).toBe("mailto:a@b.org");
    expect(linkHref("www.x.org")).toBe("http://www.x.org");
  });

  it("writes a reference out inline, for where its definition isn't", () => {
    const defs = () => ['[r]: https://r.org "T"'];
    expect(inlinedReference("[a *b*][r]", defs)).toBe(
      '[a *b*](https://r.org "T")',
    );
    expect(inlinedReference("[a](u)", defs)).toBeNull();
  });
});

describe("splitAroundLink", () => {
  it("finds what was typed around a link", () => {
    expect(splitAroundLink("x[a](u) y")).toEqual({
      lead: "x",
      link: "[a](u)",
      trail: " y",
    });
    expect(splitAroundLink("https://x.org next")).toEqual({
      lead: "",
      link: "https://x.org",
      trail: " next",
    });
    expect(splitAroundLink("[a(u)")).toBeNull();
  });
});

describe("labelParts", () => {
  const parse = (markdown: string) => fromMarkdown(markdown);

  it("draws bold and code as their tags, their delimiters hidden", () => {
    expect(labelParts("a **b** `c`", parse)).toEqual([
      { kind: "hide", from: 2, to: 4 },
      { kind: "tag", from: 4, to: 5, tag: "strong" },
      { kind: "hide", from: 5, to: 7 },
      { kind: "hide", from: 8, to: 9 },
      { kind: "tag", from: 9, to: 10, tag: "code" },
      { kind: "hide", from: 10, to: 11 },
    ]);
  });

  it("hides an escape's backslash, and draws an image as the picture", () => {
    expect(labelParts("a \\* b", parse)).toEqual([
      { kind: "hide", from: 2, to: 3 },
    ]);
    expect(labelParts("![CI](b.svg)", parse)).toEqual([
      { kind: "image", from: 0, to: 12, src: "b.svg", alt: "CI" },
    ]);
  });

  it("leaves plain text alone without parsing it", () => {
    expect(
      labelParts("plain", () => {
        throw new Error("parsed");
      }),
    ).toEqual([]);
  });
});

describe("percent-escapes in a destination", () => {
  it("read as what they stand for, leaving Markdown and bad bytes escaped", () => {
    expect(encodedRuns("a%20b%E4%B8%AD%zz%29%FF")).toEqual([
      { from: 1, to: 4, text: " " },
      { from: 5, to: 14, text: "中" },
    ]);
  });

  it("are written for a space typed into a destination", () => {
    expect(encodeDestSpaces("[Nov 8](Life/Nov 8.md)")).toBe(
      "[Nov 8](Life/Nov%208.md)",
    );
    expect(encodeDestSpaces('[a](b c.md "T")')).toBe('[a](b%20c.md "T")');
    expect(encodeDestSpaces("[a](b.md)")).toBe("[a](b.md)");
  });
});
