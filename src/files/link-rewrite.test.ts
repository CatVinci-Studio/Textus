import { describe, expect, it } from "vitest";
import { linkPlanner, movedBy } from "./link-rewrite";

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
