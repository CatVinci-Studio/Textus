import { beforeAll, describe, expect, it } from "vitest";

/** The official Graph View's link parser (public/plugins/official/
 *  catvinci.graph/links.js), a plain script that puts itself on the
 *  global object. */
type Graph = {
  nodes: { id: string; name: string; missing: boolean }[];
  edges: { source: string; target: string }[];
};
let links: {
  buildGraph: (docs: { path: string; rel: string; text: string }[]) => Graph;
  neighbourhood: (graph: Graph, focus: string, depth: number) => Graph;
};

beforeAll(async () => {
  // A path in a variable: the script has no types to check against.
  const script = "../../public/plugins/official/catvinci.graph/links.js";
  await import(/* @vite-ignore */ script);
  links = (globalThis as unknown as { graphLinks: typeof links }).graphLinks;
});

const doc = (rel: string, text: string) => ({ path: `/n/${rel}`, rel, text });

describe("the graph of a folder's links", () => {
  it("links wiki links by name and Markdown links by path", () => {
    const g = links.buildGraph([
      doc(
        "a.md",
        "See [[B]], [[c.md|the C note]] and [[B#Part]]. Also [d](sub/d.md#x).",
      ),
      doc("b.md", "Back to [a](./a.md)."),
      doc("c.md", "Nothing."),
      doc("sub/d.md", "Up: [a](../a.md), and [web](https://example.com/x.md)."),
    ]);
    const pairs = g.edges
      .map((e) => `${e.source.slice(3)}→${e.target.slice(3)}`)
      .sort();
    expect(pairs).toEqual([
      "a.md→b.md",
      "a.md→c.md",
      "a.md→sub/d.md",
      "b.md→a.md",
      "sub/d.md→a.md",
    ]);
  });

  it("keeps a link to no document as a missing node, and ignores code", () => {
    const g = links.buildGraph([
      doc(
        "a.md",
        "An [[Unwritten idea]].\n\n```\n[[not a link]]\n```\nAnd `[[nor this]]`.",
      ),
    ]);
    expect(g.nodes.filter((n) => n.missing).map((n) => n.name)).toEqual([
      "Unwritten idea",
    ]);
    expect(g.edges).toHaveLength(1);
  });

  it("gives the part of the graph around one document", () => {
    const g = links.buildGraph([
      doc("a.md", "[[b]]"),
      doc("b.md", "[[c]]"),
      doc("c.md", "[[d]]"),
      doc("d.md", ""),
    ]);
    const one = links.neighbourhood(g, "/n/b.md", 1);
    expect(one.nodes.map((n) => n.name).sort()).toEqual(["a", "b", "c"]);
    const two = links.neighbourhood(g, "/n/b.md", 2);
    expect(two.nodes).toHaveLength(4);
  });
});
