import { describe, expect, it } from "vitest";
import { globToRegExp, isDocumentPath } from "./glob";
import {
  parseFrontmatter,
  splitFrontmatter,
  stringifyYaml,
  withFrontmatter,
} from "./frontmatter";
import {
  movedBy,
  planLinkUpdates,
  rewriteMovedLinks,
} from "../../links/link-rewrite";
import { relativePath } from "../../utils/path";

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

/** `doc`'s text after a rename in a folder /r holding `doc`, the renamed
 *  file (now at `to`) and `others`. */
function rw(
  text: string,
  doc: string,
  from: string,
  to: string,
  others: string[] = [],
  linkRoot: string | null = null,
) {
  const paths = [doc, to, ...others];
  const [update] = planLinkUpdates([{ path: doc, text }], paths, {
    root: "/r",
    from,
    to,
    linkRoot,
  });
  return update?.text ?? text;
}

describe("links after a rename", () => {
  it("spells a path relative to a folder", () => {
    expect(relativePath("/r/notes", "/r/notes/a.md")).toBe("a.md");
    expect(relativePath("/r/notes", "/r/other/a.md")).toBe("../other/a.md");
    expect(relativePath("/r/notes/deep", "/r/a.md")).toBe("../../a.md");
  });

  it("follows a Markdown link and a picture to the new place", () => {
    const text = "See [the plan](plan.md#goals) and ![x](img/a.png).";
    expect(rw(text, "/r/index.md", "/r/plan.md", "/r/archive/plan 2.md")).toBe(
      "See [the plan](archive/plan%202.md#goals) and ![x](img/a.png).",
    );
    expect(rw(text, "/r/index.md", "/r/img/a.png", "/r/pics/a.png")).toBe(
      "See [the plan](plan.md#goals) and ![x](pics/a.png).",
    );
  });

  it("follows a wiki link when the name changes, keeping its heading and label", () => {
    const text = "[[Plan]] and [[plan#Goals|the goals]] and [[Other]]";
    expect(rw(text, "/r/x.md", "/r/plan.md", "/r/Roadmap.md")).toBe(
      "[[Roadmap]] and [[Roadmap#Goals|the goals]] and [[Other]]",
    );
  });

  it("leaves web links, anchors and other files alone", () => {
    const text = "[a](https://e.com/plan.md) [b](#plan) [c](other.md)";
    expect(rw(text, "/r/x.md", "/r/plan.md", "/r/p.md")).toBe(text);
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
        rw(before + code + after, "/r/x.md", "/r/plan.md", "/r/Roadmap.md"),
      ).toBe(
        "See [计划](Roadmap.md#goals).\n\n" +
          code +
          "\n\nSee [[Roadmap#Goals|the goals]].",
      );
    },
  );

  it("keeps an unclosed fence unchanged through the end of the document", () => {
    const text = "[plan](plan.md)\n\n```md\n[plan](plan.md) [[plan]]";
    expect(rw(text, "/r/x.md", "/r/plan.md", "/r/p.md")).toBe(
      "[plan](p.md)\n\n```md\n[plan](plan.md) [[plan]]",
    );
  });

  it("updates a link whose label contains code", () => {
    const text = "[`plan`](plan.md) and `[[plan]]` and [[plan]]";
    expect(rw(text, "/r/x.md", "/r/plan.md", "/r/Roadmap.md")).toBe(
      "[`plan`](Roadmap.md) and `[[plan]]` and [[Roadmap]]",
    );
  });

  it("updates links beside unmatched or escaped backticks", () => {
    const text = "` [plan](plan.md) [[plan]]\n\n\\` [plan](plan.md) [[plan]]";
    expect(rw(text, "/r/x.md", "/r/plan.md", "/r/p.md")).toBe(
      "` [plan](p.md) [[p]]\n\n\\` [plan](p.md) [[p]]",
    );
  });
});

describe("links after a rename, by the file they lead to", () => {
  it("leaves a link to another note of the same name alone", () => {
    const text = "[[Note]] [[b/Note]] [n](../b/Note.md)";
    // From /r/a/x.md, [[Note]] is a/Note.md; the renamed one is b/Note.md.
    expect(
      rw(text, "/r/a/x.md", "/r/b/Note.md", "/r/b/Renamed.md", [
        "/r/a/Note.md",
      ]),
    ).toBe("[[Note]] [[b/Renamed]] [n](../b/Renamed.md)");
  });

  it("keeps a link from / written from the project's root", () => {
    const text = "[a](/docs/a.md) [b](docs/a.md)";
    expect(
      rw(text, "/r/README.md", "/r/docs/a.md", "/r/guide/a.md", [], "/r"),
    ).toBe("[a](/guide/a.md) [b](guide/a.md)");
  });

  it("follows a table's [[Note\\|alias]] and keeps its escaped bar", () => {
    expect(rw("| [[Plan\\|p]] |", "/r/x.md", "/r/Plan.md", "/r/Goal.md")).toBe(
      "| [[Goal\\|p]] |",
    );
  });

  it("follows [t](Note) without .md, and keeps it without", () => {
    expect(rw("[t](Plan)", "/r/x.md", "/r/Plan.md", "/r/Goal.md")).toBe(
      "[t](Goal)",
    );
  });

  it("writes a moved note's path when its name alone would find another", () => {
    expect(
      rw("[[Plan]]", "/r/x.md", "/r/Plan.md", "/r/old/Note.md", ["/r/Note.md"]),
    ).toBe("[[old/Note]]");
  });

  it("leaves every other byte alone", () => {
    const text = "a\r\n[[Plan#^abc|x]]  \r\n\tb [[Other]]\r\n";
    expect(
      rw(text, "/r/x.md", "/r/Plan.md", "/r/Goal.md", ["/r/Other.md"]),
    ).toBe("a\r\n[[Goal#^abc|x]]  \r\n\tb [[Other]]\r\n");
  });
});

describe("a moved document's own links", () => {
  it("lead where they led before, wiki links and links from / untouched", () => {
    const text =
      "![](assets/a.png) [b](../b.md#x) [[Note]] [r](/r.md) [w](https://e.com)";
    const from = "/r/notes/x.md";
    const move = {
      root: "/r",
      files: [from],
      moved: movedBy(from, "/r/archive/2024/x.md"),
    };
    expect(rewriteMovedLinks(text, from, move).text).toBe(
      "![](../../notes/assets/a.png) [b](../../b.md#x) [[Note]] [r](/r.md) [w](https://e.com)",
    );
  });
});
