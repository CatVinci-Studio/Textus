import { describe, expect, it } from "vitest";
import type { PluginDocumentMeta } from "../../platform/ipc";
import {
  documentOf,
  pathIndex,
  resolveIn,
  resolveTarget,
  targetLine,
} from "./metadata-cache";

const paths = pathIndex("/v", [
  "/v/Notes/Ann.md",
  "/v/People/Ann.md",
  "/v/Deep/Way/Down/Bo.md",
  "/v/Bo.markdown",
  "/v/Docs/guide.md",
]);

describe("resolveIn", () => {
  it("finds a wiki link by name, its own folder's first, else the shortest", () => {
    expect(resolveIn(paths, "Ann", "/v/People/x.md", true)).toBe(
      "/v/People/Ann.md",
    );
    expect(resolveIn(paths, "ann", "/v/Other/x.md", true)).toBe(
      "/v/Notes/Ann.md",
    );
    expect(resolveIn(paths, "Bo#Part|alias", "/v/Other/x.md", true)).toBe(
      "/v/Bo.markdown",
    );
    expect(resolveIn(paths, "Nobody", "/v/x.md", true)).toBeNull();
  });

  it("reads anything else as a path from the linking document's folder", () => {
    expect(resolveIn(paths, "../Docs/guide.md", "/v/Notes/x.md", false)).toBe(
      "/v/Docs/guide.md",
    );
    expect(resolveIn(paths, "Docs/guide", "/v/x.md", false)).toBe(
      "/v/Docs/guide.md",
    );
    expect(
      resolveIn(paths, "https://example.com", "/v/x.md", false),
    ).toBeNull();
  });

  it("indexes ten thousand paths for lookups that don't walk them", () => {
    const many = Array.from(
      { length: 10_000 },
      (_, i) => `/v/n${i % 40}/Note ${i}.md`,
    );
    const index = pathIndex("/v", many);
    const start = performance.now();
    for (let i = 0; i < 20_000; i++)
      resolveIn(index, `Note ${i % 10_000}`, "/v/n1/x.md", true);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("a document's metadata", () => {
  const root = "/v";
  const meta = (rel: string, more: Partial<PluginDocumentMeta> = {}) => ({
    path: `${root}/${rel}`,
    rel,
    title: rel,
    frontmatter: null,
    headings: [],
    links: [],
    tags: [],
    tasks: [],
    blockIds: [],
    blocks: null,
    modifiedMs: null,
    ...more,
  });
  const docs = [
    meta("a/Note.md", {
      headings: [{ level: 2, text: "Plan", line: 3 }],
      blockIds: [{ id: "abc123", line: 7, text: "A line" }],
    }),
    meta("Note.md"),
    meta("b/x.md", {
      frontmatter: "tags: [one, '#two']\naliases: My note, Mine",
      tags: ["one", "three"],
      links: [{ target: "Note\\", text: "x", line: 0, wiki: true }],
    }),
  ];
  const paths = pathIndex(
    root,
    docs.map((d) => d.path),
  );
  const index = {
    root,
    documents: docs.map((d) => documentOf(d, paths)),
    byPath: new Map(docs.map((d) => [d.path, documentOf(d, paths)])),
    paths,
  };

  it("takes tags and aliases from front matter too", () => {
    const x = documentOf(docs[2], paths);
    expect(x.tags).toEqual(["two", "one", "three"]);
    expect(x.aliases).toEqual(["My note", "Mine"]);
  });

  it("resolves a link as a click does, to the line of its block or heading", () => {
    const block = resolveTarget(paths, "[[Note#^abc123]]", "/v/a/y.md")!;
    expect(block).toMatchObject({ path: "/v/a/Note.md", block: "abc123" });
    expect(targetLine(index, block)).toBe(7);
    const heading = resolveTarget(paths, "[[Note#Plan]]", "/v/a/y.md")!;
    expect(targetLine(index, heading)).toBe(3);
    // A heading named as a click names it: by its slug too.
    expect(targetLine(index, { ...heading, heading: "plan" })).toBe(3);
    expect(resolveTarget(paths, "[[Note v1.2]]", "/v/a/y.md")).toMatchObject({
      path: "/v/a/Note v1.2.md",
      exists: false,
    });
  });
});
