import { describe, expect, it } from "vitest";
import { globToRegExp, isDocumentPath } from "./glob";
import {
  parseFrontmatter,
  splitFrontmatter,
  stringifyYaml,
  withFrontmatter,
} from "./frontmatter";
import { relativePath, rewriteLinks } from "./link-rewrite";

describe("a glob", () => {
  const matches = (glob: string, path: string) => globToRegExp(glob).test(path);

  it("matches within a folder's name with *, any folders with **", () => {
    expect(matches("*.md", "a.md")).toBe(true);
    expect(matches("*.md", "notes/a.md")).toBe(false);
    expect(matches("**/*.md", "a.md")).toBe(true);
    expect(matches("**/*.md", "notes/2026/a.md")).toBe(true);
    expect(matches("Daily/*.md", "daily/2026-10-25.md")).toBe(true);
    expect(matches("notes/**", "notes/x/y.png")).toBe(true);
  });

  it("takes ? for one character and {a,b} for either", () => {
    expect(matches("?.md", "a.md")).toBe(true);
    expect(matches("?.md", "ab.md")).toBe(false);
    expect(matches("*.{png,jpg}", "x.jpg")).toBe(true);
    expect(matches("*.{png,jpg}", "x.gif")).toBe(false);
  });

  it("knows a document by its name", () => {
    expect(isDocumentPath("/a/b.md")).toBe(true);
    expect(isDocumentPath("/a/b.MARKDOWN")).toBe(true);
    expect(isDocumentPath("/a/b.pdf")).toBe(false);
  });
});

describe("front matter", () => {
  const doc = [
    "---",
    "title: A day",
    'quote: "a: b"',
    "count: 3",
    "done: false",
    "tags: [work, home]",
    "aliases:",
    "  - first",
    "  - second",
    "meta:",
    "  author: Ann",
    "empty:",
    "---",
    "# Body",
  ].join("\n");

  it("reads keys, numbers, booleans, lists and one level of nesting", () => {
    expect(parseFrontmatter(doc)).toEqual({
      title: "A day",
      quote: "a: b",
      count: 3,
      done: false,
      tags: ["work", "home"],
      aliases: ["first", "second"],
      meta: { author: "Ann" },
      empty: null,
    });
  });

  it("is {} for a document without any", () => {
    expect(parseFrontmatter("# Just a title")).toEqual({});
    expect(splitFrontmatter("# x").yaml).toBeNull();
  });

  it("writes back what it read, the body untouched", () => {
    const data = parseFrontmatter(doc);
    const again = withFrontmatter(doc, { ...data, count: 4 });
    expect(again.endsWith("# Body")).toBe(true);
    expect(parseFrontmatter(again)).toEqual({ ...data, count: 4 });
  });

  it("quotes what YAML would read otherwise", () => {
    expect(stringifyYaml({ a: "true", b: "x: y", c: "12", d: "plain" })).toBe(
      'a: "true"\nb: "x: y"\nc: "12"\nd: plain',
    );
  });

  it("adds a block to a document without one, and takes it away when empty", () => {
    expect(withFrontmatter("Text", { a: 1 })).toBe("---\na: 1\n---\n\nText");
    expect(withFrontmatter("---\na: 1\n---\nText", {})).toBe("Text");
  });
});

describe("links after a rename", () => {
  it("spells a path relative to a folder", () => {
    expect(relativePath("/r/notes", "/r/notes/a.md")).toBe("a.md");
    expect(relativePath("/r/notes", "/r/other/a.md")).toBe("../other/a.md");
    expect(relativePath("/r/notes/deep", "/r/a.md")).toBe("../../a.md");
  });

  it("follows a Markdown link and a picture to the new place", () => {
    const text = "See [the plan](plan.md#goals) and ![x](img/a.png).";
    expect(
      rewriteLinks(text, "/r/index.md", "/r/plan.md", "/r/archive/plan 2.md"),
    ).toBe("See [the plan](archive/plan%202.md#goals) and ![x](img/a.png).");
    expect(
      rewriteLinks(text, "/r/index.md", "/r/img/a.png", "/r/pics/a.png"),
    ).toBe("See [the plan](plan.md#goals) and ![x](pics/a.png).");
  });

  it("follows a wiki link when the name changes, keeping its heading and label", () => {
    const text = "[[Plan]] and [[plan#Goals|the goals]] and [[Other]]";
    expect(rewriteLinks(text, "/r/x.md", "/r/plan.md", "/r/Roadmap.md")).toBe(
      "[[Roadmap]] and [[Roadmap#Goals|the goals]] and [[Other]]",
    );
  });

  it("leaves web links, anchors and other files alone", () => {
    const text = "[a](https://e.com/plan.md) [b](#plan) [c](other.md)";
    expect(rewriteLinks(text, "/r/x.md", "/r/plan.md", "/r/p.md")).toBe(text);
  });

  it.each([
    ["inline code", "`[plan](plan.md) [[plan]] ![plan](plan.md)`"],
    ["longer code spans", "``a ` [plan](plan.md) [[plan]]``"],
    ["multiline code spans", "`example\n[plan](plan.md) [[plan]]`"],
    ["backtick fences", "```md\n[plan](plan.md) [[plan]]\n```"],
    ["tilde fences", "~~~md\n[plan](plan.md) [[plan]]\n~~~"],
    ["longer fences", "````md\n```\n[plan](plan.md) [[plan]]\n````"],
    ["indented code", "    [plan](plan.md) [[plan]]"],
    ["quoted code", "> ```md\n> [plan](plan.md) [[plan]]\n> ```"],
    [
      "code in a list",
      "- Example:\n\n  ```md\n  [plan](plan.md) [[plan]]\n  ```",
    ],
    ["Windows line endings", "```md\r\n[plan](plan.md) [[plan]]\r\n```"],
  ])(
    "keeps %s unchanged while links around it follow the rename",
    (_, code) => {
      const before = "See [计划](plan.md#goals).\n\n";
      const after = "\n\nSee [[plan#Goals|the goals]].";
      expect(
        rewriteLinks(
          before + code + after,
          "/r/x.md",
          "/r/plan.md",
          "/r/Roadmap.md",
        ),
      ).toBe(
        "See [计划](Roadmap.md#goals).\n\n" +
          code +
          "\n\nSee [[Roadmap#Goals|the goals]].",
      );
    },
  );

  it("keeps an unclosed fence unchanged through the end of the document", () => {
    const text = "[plan](plan.md)\n\n```md\n[plan](plan.md) [[plan]]";
    expect(rewriteLinks(text, "/r/x.md", "/r/plan.md", "/r/p.md")).toBe(
      "[plan](p.md)\n\n```md\n[plan](plan.md) [[plan]]",
    );
  });

  it("updates a link whose label contains code", () => {
    const text = "[`plan`](plan.md) and `[[plan]]` and [[plan]]";
    expect(rewriteLinks(text, "/r/x.md", "/r/plan.md", "/r/Roadmap.md")).toBe(
      "[`plan`](Roadmap.md) and `[[plan]]` and [[Roadmap]]",
    );
  });

  it("updates links beside unmatched or escaped backticks", () => {
    const text = "` [plan](plan.md) [[plan]]\n\n\\` [plan](plan.md) [[plan]]";
    expect(rewriteLinks(text, "/r/x.md", "/r/plan.md", "/r/p.md")).toBe(
      "` [plan](p.md) [[p]]\n\n\\` [plan](p.md) [[p]]",
    );
  });
});
