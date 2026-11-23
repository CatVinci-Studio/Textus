import { describe, expect, it } from "vitest";
import { linkPlanner, movedBy } from "./link-rewrite";
import { relativePath } from "../utils/path";

const FILES = [
  "/v/index.md",
  "/v/a/Note.md",
  "/v/b/Note.md",
  "/v/b/x.md",
  "/v/assets/pic.png",
  "/v/Note v1.2.md",
  "/v/docs/guide.md",
];

/** A move of `from` to `to` in the folder of FILES. */
function move(from: string, to: string) {
  return { root: "/v", from, to };
}

/** `text`, the document at `doc` before `m`, as the move leaves it - asked
 *  as the app asks, after the move. */
function rewriteMovedLinks(
  text: string,
  doc: string,
  m: { root: string; from: string; to: string; files?: string[] },
): { text: string; count: number } {
  const moved = movedBy(m.from, m.to);
  const after = (m.files ?? FILES).map((f) => moved(f) ?? f);
  const done = linkPlanner(after, m)({ path: moved(doc) ?? doc, text });
  return done ?? { text, count: 0 };
}

/** The documents whose links must follow the move. */
function planLinkUpdates(
  documents: { path: string; text: string }[],
  files: string[],
  plan: { root: string; from: string; to: string },
) {
  const planner = linkPlanner(files, plan);
  return documents.flatMap((doc) => planner(doc) ?? []);
}

describe("links follow a rename by the file they lead to", () => {
  it("leaves a link to a same-named note in another folder alone", () => {
    const text = "[[Note]] and [[b/Note]]";
    const out = rewriteMovedLinks(
      text,
      "/v/b/x.md",
      move("/v/a/Note.md", "/v/a/New.md"),
    );
    expect(out.text).toBe(text);
    expect(
      rewriteMovedLinks(
        "[[Note]] [[a/Note|n]]",
        "/v/a/y.md",
        move("/v/a/Note.md", "/v/a/New.md"),
      ).text,
    ).toBe("[[New]] [[a/New|n]]");
  });

  it("follows a wiki link with a folder to the note's new folder", () => {
    expect(
      rewriteMovedLinks(
        "[[a/Note#^abc123]]",
        "/v/index.md",
        move("/v/a/Note.md", "/v/c/Note.md"),
      ).text,
    ).toBe("[[c/Note#^abc123]]");
  });

  it("qualifies a bare name the move made ambiguous", () => {
    // From a/, b/Note and c/Note are as near; b/ sorts first.
    expect(
      rewriteMovedLinks(
        "[[Note]]",
        "/v/a/z.md",
        move("/v/a/Note.md", "/v/c/Note.md"),
      ).text,
    ).toBe("[[c/Note]]");
  });

  it("rebases a moved document's own relative links", () => {
    const text = "![p](assets/pic.png) [g](docs/guide.md#top) [[Note v1.2]]";
    expect(
      rewriteMovedLinks(
        text,
        "/v/index.md",
        move("/v/index.md", "/v/b/index.md"),
      ).text,
    ).toBe("![p](../assets/pic.png) [g](../docs/guide.md#top) [[Note v1.2]]");
  });

  it("keeps links inside a moved folder and follows links into it", () => {
    const files = ["/v/f/a.md", "/v/f/img/p.png", "/v/out.md"];
    const m = { ...move("/v/f", "/v/g/f"), files };
    expect(
      rewriteMovedLinks("![](img/p.png) [o](../out.md)", "/v/f/a.md", m).text,
    ).toBe("![](img/p.png) [o](../../out.md)");
    expect(rewriteMovedLinks("[a](f/a.md)", "/v/out.md", m).text).toBe(
      "[a](g/f/a.md)",
    );
  });

  it("keeps a /-rooted link rooted at the folder", () => {
    expect(
      rewriteMovedLinks(
        "[g](/docs/guide.md)",
        "/v/b/x.md",
        move("/v/docs/guide.md", "/v/guide/guide.md"),
      ).text,
    ).toBe("[g](/guide/guide.md)");
  });

  it("keeps .md where it was written, and a dotted name whole", () => {
    expect(
      rewriteMovedLinks(
        "[[Note v1.2]] [[Note v1.2.md]]",
        "/v/index.md",
        move("/v/Note v1.2.md", "/v/Note v2.md"),
      ).text,
    ).toBe("[[Note v2]] [[Note v2.md]]");
  });

  it("follows a table's escaped wiki link and a reference definition", () => {
    const text = "| [[Note\\|n]] |\n\n[g]: docs/guide.md\n[^1]: docs/guide.md";
    expect(
      rewriteMovedLinks(text, "/v/b/x.md", {
        ...move("/v/b/Note.md", "/v/b/Big.md"),
      }).text,
    ).toBe(text.replace("[[Note", "[[Big"));
    expect(
      rewriteMovedLinks(
        "[g]: ../docs/guide.md",
        "/v/b/x.md",
        move("/v/docs/guide.md", "/v/g.md"),
      ).text,
    ).toBe("[g]: ../g.md");
  });

  it("follows a Markdown link found by name, as a click finds it", () => {
    expect(
      rewriteMovedLinks(
        "[g](guide.md)",
        "/v/index.md",
        move("/v/docs/guide.md", "/v/docs/howto.md"),
      ).text,
    ).toBe("[g](howto.md)");
  });

  it("reads %23 as a click does and writes # and parentheses escaped", () => {
    const files = [...FILES, "/v/C#.md"];
    expect(
      rewriteMovedLinks("[c](C%23.md)", "/v/index.md", {
        ...move("/v/C#.md", "/v/C# (1).md"),
        files,
      }).text,
    ).toBe("[c](C%23%20%281%29.md)");
  });

  it("changes only the target's bytes, keeping each line's ending", () => {
    const text = "\uFEFFa [[Note]]\r\nb ![](../assets/pic.png)\nc\r\n";
    const out = rewriteMovedLinks(
      text,
      "/v/b/x.md",
      move("/v/b/Note.md", "/v/b/Big.md"),
    ).text;
    const expected = "\uFEFFa [[Big]]\r\nb ![](../assets/pic.png)\nc\r\n";
    expect(Buffer.from(out, "utf8").equals(Buffer.from(expected, "utf8"))).toBe(
      true,
    );
  });
});

describe("planning a rename's link updates", () => {
  it("names each changed document at its path after the move, with its count", () => {
    const files = ["/v/x.md", "/v/sub/moved.md", "/v/pic.png"];
    const documents = [
      { path: "/v/x.md", text: "[[moved]] and [m](moved.md)" },
      { path: "/v/sub/moved.md", text: "![](pic.png)" },
    ];
    expect(
      planLinkUpdates(documents, files, {
        root: "/v",
        from: "/v/moved.md",
        to: "/v/sub/moved.md",
      }),
    ).toEqual([
      { path: "/v/x.md", text: "[[moved]] and [m](sub/moved.md)", count: 1 },
      { path: "/v/sub/moved.md", text: "![](../pic.png)", count: 1 },
    ]);
  });

  it("works with Windows paths", () => {
    const updates = planLinkUpdates(
      [{ path: "C:\\v\\x.md", text: "[a](a.md)" }],
      ["C:\\v\\x.md", "C:\\v\\b.md"],
      { root: "C:\\v", from: "C:\\v\\a.md", to: "C:\\v\\b.md" },
    );
    expect(updates).toEqual([
      { path: "C:\\v\\x.md", text: "[a](b.md)", count: 1 },
    ]);
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
  const update = linkPlanner(paths, { root: "/r", from, to, linkRoot })({
    path: doc,
    text,
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

describe("a moved document's own links", () => {
  it("lead where they led before, wiki links and links from / untouched", () => {
    const text =
      "![](assets/a.png) [b](../b.md#x) [[Note]] [r](/r.md) [w](https://e.com)";
    const to = "/r/archive/2024/x.md";
    const plan = { root: "/r", from: "/r/notes/x.md", to };
    expect(linkPlanner([to], plan)({ path: to, text })?.text).toBe(
      "![](../../notes/assets/a.png) [b](../../b.md#x) [[Note]] [r](/r.md) [w](https://e.com)",
    );
  });
});

describe("links at the top of the folder and names without a folder", () => {
  const top = ["/index.md", "/Note.md", "/b/x.md"];
  /** `text` in `doc` once `from` became `to`, in a folder that is the
   *  disk's root. */
  const atTop = (doc: string, from: string, to: string, text: string) => {
    const moved = movedBy(from, to);
    const after = top.map((f) => moved(f) ?? f);
    const plan = { root: "/", from, to };
    return linkPlanner(after, plan)({ path: moved(doc) ?? doc, text })?.text;
  };

  it("follow a note moved out of the root", () => {
    expect(
      atTop(
        "/index.md",
        "/Note.md",
        "/b/Note.md",
        "[n](Note.md) [m](./Note.md) [[Note]] [[Note.md]]",
      ),
    ).toBe("[n](b/Note.md) [m](./b/Note.md) [[Note]] [[Note.md]]");
  });

  it("lead where they led from a document moved out of the root", () => {
    expect(
      atTop(
        "/index.md",
        "/index.md",
        "/b/index.md",
        "[n](Note.md) [[Note]] [x](b/x.md)",
      ),
    ).toBe("[n](../Note.md) [[Note]] [x](x.md)");
  });

  it("keep a written .md and drop an unwritten one", () => {
    expect(
      atTop(
        "/b/x.md",
        "/Note.md",
        "/Renamed.md",
        "[n](../Note.md) [[Note]] [[Note.md]]",
      ),
    ).toBe("[n](../Renamed.md) [[Renamed]] [[Renamed.md]]");
  });

  it("read a wiki name's backslash as a folder, keeping its path and its .md", () => {
    const files = ["/v/a/Note.md", "/v/i.md"];
    const moved = movedBy("/v/a/Note.md", "/v/a/New.md");
    const plan = { root: "/v", from: "/v/a/Note.md", to: "/v/a/New.md" };
    const text = "[[a\\Note.md]] [[a\\Note]] [n](a\\Note.md)";
    expect(
      linkPlanner(
        files.map((f) => moved(f) ?? f),
        plan,
      )({ path: "/v/i.md", text })?.text,
    ).toBe("[[a/New.md]] [[a/New]] [n](a/New.md)");
  });
});
