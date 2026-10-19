import { schemaCtx } from "@milkdown/kit/core";
import { Plugin } from "@milkdown/kit/prose/state";
import { DOMSerializer } from "@milkdown/kit/prose/model";
import type {
  DOMOutputSpec,
  Node as ProseNode,
} from "@milkdown/kit/prose/model";
import { $nodeSchema, $prose, $remark } from "@milkdown/kit/utils";
import type { RemarkPluginRaw } from "@milkdown/kit/transformer";
import {
  highlightFromMarkdown,
  highlightSyntax,
  highlightToMarkdown,
} from "./highlight-syntax";

// Registers "==highlighted==" parsing/serialization with remark, the same
// way remark-math registers "$...$" (see math-schema.ts) - a unified plugin
// that pushes a micromark syntax extension plus mdast fromMarkdown/
// toMarkdown extensions onto the processor's shared `data()` bag.
const remarkHighlight: RemarkPluginRaw<unknown> = function (this: {
  data: () => Record<string, unknown[]>;
}) {
  const data = this.data();
  const micromarkExtensions = (data.micromarkExtensions ??= []);
  const fromMarkdownExtensions = (data.fromMarkdownExtensions ??= []);
  const toMarkdownExtensions = (data.toMarkdownExtensions ??= []);
  micromarkExtensions.push(highlightSyntax());
  fromMarkdownExtensions.push(highlightFromMarkdown());
  toMarkdownExtensions.push(highlightToMarkdown());
} as unknown as RemarkPluginRaw<unknown>;

export const remarkHighlightPlugin = $remark(
  "remark-highlight",
  () => remarkHighlight,
);

interface MdastNode {
  type: string;
  data?: Record<string, unknown>;
  children?: MdastNode[];
  position?: { start: { offset?: number } };
}

/**
 * How many tildes a strikethrough was written with. remark-gfm reads `~x~`
 * as strikethrough too but keeps no count, and mdast writes "~~" - so a
 * Pandoc subscript, `H~2~O`, was saved as `H~~2~~O`, which reads as
 * strikethrough everywhere. Recorded here as `data.tildes`, read into the
 * node's rung below and written back by markdown-output.ts.
 */
const remarkStrikethroughTildes: RemarkPluginRaw<unknown> = () => {
  return (tree: unknown, file: { value: unknown }) => {
    const source = String(file.value);
    const walk = (node: MdastNode) => {
      const start = node.position?.start.offset;
      if (node.type === "delete" && start !== undefined)
        node.data = {
          ...node.data,
          tildes: source.startsWith("~~", start) ? 2 : 1,
        };
      node.children?.forEach(walk);
    };
    walk(tree as MdastNode);
  };
};

const tildesOf = (node: { data?: unknown }) =>
  (node.data as { tildes?: number } | undefined)?.tildes;

export const remarkStrikethroughTildesPlugin = $remark(
  "remark-strikethrough-tildes",
  () => remarkStrikethroughTildes,
);

// The literal markdown delimiter text a node renders from/reverts to -
// shared by the schema's toDOM (static "data-syntax" attribute) and
// enclosure.ts (delimiter reveal widgets, delimiter deletion/unwrap).
export function spanDelimText(node: {
  type: { name: string };
  attrs: { delim?: string; rung?: number };
}): string {
  if (node.type.name === "md_code_span") return "`";
  return (node.attrs.delim ?? "*").repeat(node.attrs.rung ?? 1);
}

// A semantic tag Textus's own parseDOM rule below still recognizes via
// data-type, so pasting this into an EXTERNAL app (which reads only the
// tag, not the attrs) shows real bold/italic/strikethrough/highlight
// instead of an unstyled <span>. Bold+italic together (rung 3) has no
// single tag for it: on the clipboard it is nested strong>em - how remark
// itself represents "***text***", and what other apps expect to see. In the
// editor it stays one <strong> (italic comes from content-base.css): the
// browser types into an empty shell's <strong>, outside an inner <em>, and
// ProseMirror, reading the content only from the <em>, dropped every
// character typed after "***".
function mdSpanDOM(node: ProseNode, forClipboard: boolean): DOMOutputSpec {
  const delim = node.attrs.delim as string;
  const rung = node.attrs.rung as number;
  const attrs = {
    "data-type": "md_span",
    "data-delim": delim,
    "data-rung": String(rung),
    "data-syntax": spanDelimText(node),
    class: "md-span",
  };
  if (delim === "~") return ["del", attrs, 0];
  if (delim === "=") return ["mark", attrs, 0];
  if (rung === 3)
    return forClipboard ? ["strong", attrs, ["em", 0]] : ["strong", attrs, 0];
  if (rung === 2) return ["strong", attrs, 0];
  return ["em", attrs, 0];
}

/** Copies bold+italic as strong>em (see mdSpanDOM); everything else is
 *  serialized as the schema renders it. */
export const mdSpanClipboardPlugin = $prose((ctx) => {
  const base = DOMSerializer.fromSchema(ctx.get(schemaCtx));
  const serializer = new DOMSerializer(
    { ...base.nodes, md_span: (node) => mdSpanDOM(node, true) },
    base.marks,
  );
  return new Plugin({ props: { clipboardSerializer: serializer } });
});

// One node type covers bold/italic/bold+italic/strikethrough/highlight -
// they're all "wrap some inline content in a repeated delimiter", differing
// only in which character and how many of them. `delim`+`rung` together
// pick the rendered style and the markdown wrapper on save (see toMarkdown
// below); for "*" the rung is the style (1 = italic, 2 = bold, 3 = both),
// for "~" only how many tildes the file had (`~x~` is rung 1, though the
// editor makes "~~"), and "=" is always rung 2.
export const mdSpanSchema = $nodeSchema("md_span", () => ({
  content: "inline*",
  group: "inline",
  inline: true,
  attrs: {
    delim: { default: "*" },
    rung: { default: 1 },
  },
  parseDOM: [
    {
      // Not tag-specific ([data-type=...] alone) because toDOM below picks
      // the wrapper tag by delim/rung (strong/em/del/mark) rather than
      // always "span" - this must still recognize Textus's own re-pasted
      // content regardless of which tag it rendered as.
      tag: '[data-type="md_span"]',
      getAttrs: (dom) => ({
        delim: (dom as HTMLElement).dataset.delim || "*",
        rung: Number((dom as HTMLElement).dataset.rung) || 1,
      }),
      // A copied bold+italic span carries an inner <em> (see
      // mdSpanClipboardPlugin above) that the rung already says - read
      // past it rather than nesting an italic span inside.
      contentElement: (dom) => {
        const el = dom as HTMLElement;
        const inner = el.firstElementChild;
        return el.dataset.rung === "3" &&
          inner?.tagName === "EM" &&
          el.childNodes.length === 1
          ? (inner as HTMLElement)
          : el;
      },
    },
    // Standard semantic tags - recognizes bold/italic/strikethrough/highlight
    // pasted in from anywhere else (a browser, Notion, another editor),
    // which otherwise carried no formatting this schema could see at all.
    // Lower priority than the rule above: Textus's own data-type-marked
    // content must always resolve through its own attrs, never get
    // re-derived from (and second-guessed via) the tag name.
    { tag: "strong", priority: 40, getAttrs: () => ({ delim: "*", rung: 2 }) },
    { tag: "b", priority: 40, getAttrs: () => ({ delim: "*", rung: 2 }) },
    { tag: "em", priority: 40, getAttrs: () => ({ delim: "*", rung: 1 }) },
    { tag: "i", priority: 40, getAttrs: () => ({ delim: "*", rung: 1 }) },
    { tag: "del", priority: 40, getAttrs: () => ({ delim: "~", rung: 2 }) },
    { tag: "s", priority: 40, getAttrs: () => ({ delim: "~", rung: 2 }) },
    { tag: "strike", priority: 40, getAttrs: () => ({ delim: "~", rung: 2 }) },
    { tag: "mark", priority: 40, getAttrs: () => ({ delim: "=", rung: 2 }) },
  ],
  toDOM: (node) => mdSpanDOM(node, false),
  parseMarkdown: {
    match: (node) =>
      node.type === "strong" ||
      node.type === "emphasis" ||
      node.type === "delete" ||
      node.type === "mark",
    runner: (state, node, type) => {
      const attrs =
        node.type === "strong"
          ? { delim: "*", rung: 2 }
          : node.type === "emphasis"
            ? { delim: "*", rung: 1 }
            : node.type === "delete"
              ? { delim: "~", rung: tildesOf(node) === 1 ? 1 : 2 }
              : { delim: "=", rung: 2 };
      state.openNode(type, attrs);
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "md_span",
    runner: (state, node) => {
      const delim = node.attrs.delim as string;
      const rung = node.attrs.rung as number;
      if (delim === "*" && rung === 3) {
        // Bold+italic together: mdast represents this as nested strong>emphasis,
        // not a single node - matches how remark itself parses "***text***".
        state
          .openNode("strong")
          .openNode("emphasis")
          .next(node.content)
          .closeNode()
          .closeNode();
        return;
      }
      const mdastType =
        delim === "*"
          ? rung === 2
            ? "strong"
            : "emphasis"
          : delim === "~"
            ? "delete"
            : "mark";
      state
        .openNode(
          mdastType,
          undefined,
          delim === "~" && rung === 1 ? { data: { tildes: 1 } } : undefined,
        )
        .next(node.content)
        .closeNode();
    },
  },
}));

// Inline code is kept as its own, separate node type (rather than another
// md_span rung) because its content must never contain nested formatting -
// backtick spans are verbatim text, matching how the stock inlineCode mark
// and math_inline both already treat their content as plain, unmarked text.
export const mdCodeSpanSchema = $nodeSchema("md_code_span", () => ({
  content: "text*",
  group: "inline",
  inline: true,
  marks: "",
  code: true,
  attrs: {},
  parseDOM: [
    { tag: 'code[data-type="md_code_span"]' },
    // A bare <code> from anywhere else (a web page, GitHub, another
    // editor) - excluding one inside <pre> (a fenced code BLOCK), whose own
    // parseDOM already owns that shape; without this exclusion an entire
    // pasted code block's content would get misread as one inline code
    // span. Lower priority so Textus's own data-type-marked rule above wins
    // when both could match.
    {
      tag: "code",
      priority: 40,
      getAttrs: (dom) =>
        (dom as HTMLElement).parentElement?.tagName === "PRE" ? false : {},
    },
  ],
  toDOM: () => [
    "code",
    { "data-type": "md_code_span", "data-syntax": "`", class: "md-code-span" },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === "inlineCode",
    // Added whole rather than opened and closed: the text stays unmarked
    // (code is verbatim) while a link around it - `[`code`](url)` - lands
    // on the node itself and is written back out around the backticks.
    // closeNode would also drop the link for the text after it.
    runner: (state, node, type) => {
      const value = node.value as string | undefined;
      state.addNode(type, undefined, value ? [state.schema.text(value)] : []);
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "md_code_span",
    runner: (state, node) => {
      state.addNode(
        "inlineCode",
        undefined,
        node.content.firstChild?.text || "",
      );
    },
  },
}));
