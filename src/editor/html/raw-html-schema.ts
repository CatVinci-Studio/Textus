import { $nodeSchema } from "@milkdown/kit/utils";

/**
 * Replaces stock Milkdown's `htmlSchema`, an atom that just echoes the tag
 * text, with real text content a cursor can edit. Block-position HTML is
 * already rewritten to `paragraph > html`, so this one inline node covers it.
 */
export const rawHtmlSchema = $nodeSchema("html", () => ({
  content: "text*",
  group: "inline",
  inline: true,
  marks: "",
  // Opaque: typing "*" inside raw HTML shouldn't make a bold md_span.
  code: true,
  // Verbatim (remark-verbatim): a document type's own syntax, never drawn.
  attrs: { verbatim: { default: false } },
  parseDOM: [
    {
      tag: 'span[data-type="html"]',
      preserveWhitespace: "full",
      getAttrs: (dom) => ({ verbatim: dom.hasAttribute("data-verbatim") }),
    },
  ],
  toDOM: (node) => [
    "span",
    {
      "data-type": "html",
      class: "raw-html-source",
      ...(node.attrs.verbatim ? { "data-verbatim": "" } : {}),
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === "html",
    runner: (state, node, type) => {
      state.openNode(type, {
        verbatim: !!(node.data as { verbatim?: boolean } | undefined)?.verbatim,
      });
      if (node.value) state.addText(node.value as string);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "html",
    // node.textContent, not the first child's text: an edit can leave several
    // text nodes, and the rest would be dropped on save.
    runner: (state, node) => {
      state.addNode("html", undefined, node.textContent);
    },
  },
}));
