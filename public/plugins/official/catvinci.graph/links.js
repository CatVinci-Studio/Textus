// The links of the folder's documents, as a graph: a node per document,
// an edge per link from one to another - [[wiki links]] (by file name,
// with or without .md, |alias and #heading allowed) and Markdown links to
// a relative .md path. A wiki link to no document is a node too, marked
// missing, as Obsidian shows one. Plain JavaScript, shared by the host
// (host.js) and the unit test (graph-links.test.ts).
(function (root) {
  "use strict";
  const WIKI = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;
  const MD =
    /\]\(\s*<?([^)\s>]+?\.(?:md|markdown))(?:#[^)\s]*)?>?(?:\s+"[^"]*")?\s*\)/gi;

  const stem = (path) =>
    path
      .split(/[\\/]/)
      .pop()
      .replace(/\.(md|markdown)$/i, "");

  /** "a/b/../c.md" from `from`'s folder, "/"-separated. */
  function resolveRelative(fromRel, target) {
    const parts = fromRel.split("/").slice(0, -1);
    for (const part of decodeURIComponent(target).split("/")) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    return parts.join("/");
  }

  /** Code spans and fenced blocks out of the way: a link in code isn't one. */
  function prose(text) {
    return text.replace(/(```|~~~)[\s\S]*?\1/g, "").replace(/`[^`\n]*`/g, "");
  }

  /** `docs`: [{ path, rel, text }]. Returns { nodes, edges }. */
  function buildGraph(docs) {
    const byStem = new Map();
    const byRel = new Map();
    const nodes = docs.map((doc) => ({
      id: doc.path,
      name: stem(doc.path),
      rel: doc.rel,
      missing: false,
    }));
    nodes.forEach((node, i) => {
      const key = node.name.toLowerCase();
      if (!byStem.has(key)) byStem.set(key, node);
      byRel.set(docs[i].rel.toLowerCase(), node);
    });
    const edges = [];
    const seen = new Set();
    const missing = new Map();
    const link = (from, to) => {
      if (from === to) return;
      const key = from + "\n" + to;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ source: from, target: to });
    };
    docs.forEach((doc) => {
      const text = prose(doc.text);
      for (const m of text.matchAll(WIKI)) {
        const name = m[1].trim().replace(/\.(md|markdown)$/i, "");
        const target =
          byStem.get(name.toLowerCase()) ||
          byRel.get((name + ".md").toLowerCase());
        if (target) link(doc.path, target.id);
        else {
          const id = "missing:" + name.toLowerCase();
          if (!missing.has(id))
            missing.set(id, { id: id, name: name, rel: null, missing: true });
          link(doc.path, id);
        }
      }
      for (const m of text.matchAll(MD)) {
        if (/^[a-z]+:/i.test(m[1])) continue;
        const target = byRel.get(resolveRelative(doc.rel, m[1]).toLowerCase());
        if (target) link(doc.path, target.id);
      }
    });
    return { nodes: nodes.concat([...missing.values()]), edges: edges };
  }

  /** The part of `graph` within `depth` links of `focus`, either way. */
  function neighbourhood(graph, focus, depth) {
    const near = new Set([focus]);
    let frontier = [focus];
    for (let d = 0; d < depth; d++) {
      const next = [];
      for (const e of graph.edges) {
        for (const [a, b] of [
          [e.source, e.target],
          [e.target, e.source],
        ])
          if (frontier.includes(a) && !near.has(b)) {
            near.add(b);
            next.push(b);
          }
      }
      frontier = next;
    }
    return {
      nodes: graph.nodes.filter((n) => near.has(n.id)),
      edges: graph.edges.filter(
        (e) => near.has(e.source) && near.has(e.target),
      ),
    };
  }

  root.graphLinks = { buildGraph: buildGraph, neighbourhood: neighbourhood };
})(typeof window !== "undefined" ? window : globalThis);
