import { schemaCtx } from "@milkdown/kit/core";
import { Plugin } from "@milkdown/kit/prose/state";
import { DOMSerializer, Fragment } from "@milkdown/kit/prose/model";
import type {
  DOMOutputSpec,
  Node as ProseNode,
} from "@milkdown/kit/prose/model";
import { $nodeSchema, $prose, $remark } from "@milkdown/kit/utils";
import type {
  MarkdownNode,
  RemarkPluginRaw,
  SerializerState,
} from "@milkdown/kit/transformer";
import {
  highlightFromMarkdown,
  highlightSyntax,
  highlightToMarkdown,
} from "./highlight-syntax";
import {
  superscriptFromMarkdown,
  superscriptSyntax,
  superscriptToMarkdown,
} from "./superscript-syntax";

// Registers "==highlighted==" with remark the way remark-math registers
// "$...$": extensions pushed onto the processor's shared `data()`.
const remarkHighlight: RemarkPluginRaw<unknown> = function (
  this: ThisParameterType<RemarkPluginRaw<unknown>>,
) {
  const data = this.data();
  const micromarkExtensions = (data.micromarkExtensions ??= []);
  const fromMarkdownExtensions = (data.fromMarkdownExtensions ??= []);
  const toMarkdownExtensions = (data.toMarkdownExtensions ??= []);
  micromarkExtensions.push(highlightSyntax());
  fromMarkdownExtensions.push(highlightFromMarkdown());
  toMarkdownExtensions.push(highlightToMarkdown());
};

export const remarkHighlightPlugin = $remark(
  "remark-highlight",
  () => remarkHighlight,
);

// "^superscript^", the same way.
const remarkSuperscript: RemarkPluginRaw<unknown> = function (
  this: ThisParameterType<RemarkPluginRaw<unknown>>,
) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(superscriptSyntax());
  (data.fromMarkdownExtensions ??= []).push(superscriptFromMarkdown());
  (data.toMarkdownExtensions ??= []).push(superscriptToMarkdown());
};

export const remarkSuperscriptPlugin = $remark(
  "remark-superscript",
  () => remarkSuperscript,
);

interface MdastNode {
  type: string;
  data?: Record<string, unknown>;
  children?: MdastNode[];
  position?: { start: { offset?: number } };
}

/**
 * How many tildes a strikethrough was written with: remark-gfm keeps no
 * count, so a Pandoc subscript `H~2~O` was saved as strikethrough `H~~2~~O`.
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

/** Italic written with underscores, `_text_`, recorded so it is written
 *  back with underscores rather than `*text*`. */
const remarkEmphasisUnderscores: RemarkPluginRaw<unknown> = () => {
  return (tree: unknown, file: { value: unknown }) => {
    const source = String(file.value);
    const walk = (node: MdastNode) => {
      const start = node.position?.start.offset;
      if (
        node.type === "emphasis" &&
        start !== undefined &&
        source[start] === "_"
      )
        node.data = { ...node.data, marker: "_" };
      node.children?.forEach(walk);
    };
    walk(tree as MdastNode);
  };
};

const markerOf = (node: { data?: unknown }) =>
  (node.data as { marker?: string } | undefined)?.marker;

export const remarkEmphasisUnderscoresPlugin = $remark(
  "remark-emphasis-underscores",
  () => remarkEmphasisUnderscores,
);

// The literal delimiter text a node renders from and reverts to.
export function spanDelimText(node: {
  type: { name: string };
  attrs: { delim?: string; rung?: number };
}): string {
  if (node.type.name === "md_code_span") return "`";
  return (node.attrs.delim ?? "*").repeat(node.attrs.rung ?? 1);
}

// A semantic tag, so an external app pasted into shows real formatting.
// Bold+italic is nested strong>em on the clipboard, as remark represents
// "***text***", but one <strong> in the editor: the browser typed outside
// an inner <em>, and ProseMirror dropped those characters.
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
  // One tilde is Pandoc's and Typora's subscript, `H~2~O`; two strike out.
  if (delim === "~") return [rung === 1 ? "sub" : "del", attrs, 0];
  if (delim === "^") return ["sup", attrs, 0];
  if (delim === "=") return ["mark", attrs, 0];
  if (rung === 3)
    return forClipboard ? ["strong", attrs, ["em", 0]] : ["strong", attrs, 0];
  if (rung === 2) return ["strong", attrs, 0];
  return ["em", attrs, 0];
}

/** Copies bold+italic as strong>em; everything else as the schema renders
 *  it. */
export const mdSpanClipboardPlugin = $prose((ctx) => {
  const base = DOMSerializer.fromSchema(ctx.get(schemaCtx));
  const serializer = new DOMSerializer(
    { ...base.nodes, md_span: (node) => mdSpanDOM(node, true) },
    base.marks,
  );
  return new Plugin({ props: { clipboardSerializer: serializer } });
});

// One node type for every repeated-delimiter wrapper. For "*" the rung is
// the style (1 italic, 2 bold, 3 both); for "~" how many tildes the file had;
// "=" is always rung 2; "_" is italic written `_text_`, rung 1; "^" is
// superscript, rung 1.
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
      // Not tag-specific: toDOM picks the tag by delim/rung, and Textus's own
      // re-pasted content must match whichever it rendered as.
      tag: '[data-type="md_span"]',
      getAttrs: (dom) => ({
        delim: (dom as HTMLElement).dataset.delim || "*",
        rung: Number((dom as HTMLElement).dataset.rung) || 1,
      }),
      // A copied bold+italic span's inner <em> is what the rung already says:
      // read past it rather than nest an italic span inside.
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
    // Standard tags, for formatting pasted from anywhere else. Lower priority,
    // so Textus's own data-type content resolves through its own attrs.
    { tag: "strong", priority: 40, getAttrs: () => ({ delim: "*", rung: 2 }) },
    { tag: "b", priority: 40, getAttrs: () => ({ delim: "*", rung: 2 }) },
    { tag: "em", priority: 40, getAttrs: () => ({ delim: "*", rung: 1 }) },
    { tag: "i", priority: 40, getAttrs: () => ({ delim: "*", rung: 1 }) },
    { tag: "del", priority: 40, getAttrs: () => ({ delim: "~", rung: 2 }) },
    { tag: "s", priority: 40, getAttrs: () => ({ delim: "~", rung: 2 }) },
    { tag: "strike", priority: 40, getAttrs: () => ({ delim: "~", rung: 2 }) },
    { tag: "mark", priority: 40, getAttrs: () => ({ delim: "=", rung: 2 }) },
    { tag: "sub", priority: 40, getAttrs: () => ({ delim: "~", rung: 1 }) },
    { tag: "sup", priority: 40, getAttrs: () => ({ delim: "^", rung: 1 }) },
  ],
  toDOM: (node) => mdSpanDOM(node, false),
  parseMarkdown: {
    match: (node) =>
      node.type === "strong" ||
      node.type === "emphasis" ||
      node.type === "delete" ||
      node.type === "mark" ||
      node.type === "superscript",
    runner: (state, node, type) => {
      const attrs =
        node.type === "strong"
          ? { delim: "*", rung: 2 }
          : node.type === "emphasis"
            ? { delim: markerOf(node) === "_" ? "_" : "*", rung: 1 }
            : node.type === "delete"
              ? { delim: "~", rung: tildesOf(node) === 1 ? 1 : 2 }
              : node.type === "superscript"
                ? { delim: "^", rung: 1 }
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
      // Spaces and line ends at the span's edges go outside it: `*Anno di *` is no
      // emphasis. An empty span writes nothing rather than a literal `**`.
      const { inner, before, after } = withoutEdgeSpaces(node.content);
      if (before) state.addNode("text", undefined, before);
      const children = inner.size ? phrasing(state, inner) : [];
      if (children.length) {
        if (delim === "*" && rung === 3)
          // Bold+italic: nested strong>emphasis, as remark parses "***text***".
          state.addNode("strong", [{ type: "emphasis", children }]);
        else if (delim === "_")
          // Milkdown's emphasis handler writes the node's own marker.
          state.addNode("emphasis", children, undefined, { marker: "_" });
        else
          state.addNode(
            delim === "*"
              ? rung === 2
                ? "strong"
                : "emphasis"
              : delim === "~"
                ? "delete"
                : delim === "^"
                  ? "superscript"
                  : "mark",
            children,
            undefined,
            delim === "~" && rung === 1 ? { data: { tildes: 1 } } : undefined,
          );
      }
      if (after) state.addNode("text", undefined, after);
    },
  },
}));

/** A span with no text in it, or only empty spans: written as nothing. */
export function isEmptySpan(node: ProseNode): boolean {
  if (node.type.name === "md_code_span") return node.textContent === "";
  if (node.type.name !== "md_span") return false;
  let empty = true;
  node.forEach((child) => {
    empty &&= isEmptySpan(child);
  });
  return empty;
}

/** A span's content without the spaces and line ends at its two ends,
 *  and those, as text. */
function withoutEdgeSpaces(content: Fragment): {
  inner: Fragment;
  before: string;
  after: string;
} {
  const nodes: ProseNode[] = [];
  content.forEach((node) => {
    if (!isEmptySpan(node)) nodes.push(node);
  });
  const before = takeEdgeSpaces(nodes, true);
  const after = takeEdgeSpaces(nodes, false);
  return { inner: Fragment.from(nodes), before, after };
}

/** The white space at one end of `nodes`, taken off them. A span there
 *  gives up its own, or `***e** *` would read back as `*e *`. */
function takeEdgeSpaces(nodes: ProseNode[], atStart: boolean): string {
  let taken = "";
  const add = (spaces: string) => {
    taken = atStart ? taken + spaces : spaces + taken;
  };
  while (nodes.length) {
    const index = atStart ? 0 : nodes.length - 1;
    const node = nodes[index];
    if (node.type.name === "hardbreak" && node.attrs.isInline) {
      nodes.splice(index, 1);
      add("\n");
      continue;
    }
    if (node.type.name === "md_span") {
      const inner: ProseNode[] = [];
      node.content.forEach((child) => {
        if (!isEmptySpan(child)) inner.push(child);
      });
      add(takeEdgeSpaces(inner, atStart));
      if (inner.length) {
        nodes[index] = node.copy(Fragment.from(inner));
        break;
      }
      nodes.splice(index, 1);
      continue;
    }
    if (!node.isText) break;
    const text = node.text!;
    const spaces = (atStart ? /^[ \t]*/ : /[ \t]*$/).exec(text)![0];
    const rest = atStart
      ? text.slice(spaces.length)
      : text.slice(0, text.length - spaces.length);
    add(spaces);
    if (rest) {
      nodes[index] = node.type.schema.text(rest, node.marks);
      break;
    }
    nodes.splice(index, 1);
  }
  return taken;
}

/**
 * A span's content as mdast, from a serializer of its own: Milkdown closes
 * a link mark at a span's content end, writing `[a](u) **[b](u)** [c](u)`.
 * Written apart, the content can't close what is open around the span.
 */
function phrasing(state: SerializerState, content: Fragment): MarkdownNode[] {
  const Serializer = state.constructor as new (
    schema: SerializerState["schema"],
  ) => SerializerState;
  const own = new Serializer(state.schema);
  own.openNode("paragraph").next(content);
  return (own.build().children ?? []) as MarkdownNode[];
}

// Inline code is its own node type, since backtick spans are verbatim text
// with no nested formatting.
export const mdCodeSpanSchema = $nodeSchema("md_code_span", () => ({
  content: "text*",
  group: "inline",
  inline: true,
  marks: "",
  code: true,
  attrs: {},
  parseDOM: [
    { tag: 'code[data-type="md_code_span"]' },
    // A bare <code> from anywhere else, but not one inside <pre>: that is a code
    // block, which would be misread as one inline span. Lower priority.
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
    // Added whole: the text stays unmarked while a link around it lands on the
    // node itself; closeNode would also drop the link for the text after it.
    runner: (state, node, type) => {
      const value = node.value as string | undefined;
      state.addNode(type, undefined, value ? [state.schema.text(value)] : []);
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "md_code_span",
    runner: (state, node) => {
      // An emptied span writes nothing: two backticks read back as text.
      const text = node.content.firstChild?.text;
      if (text) state.addNode("inlineCode", undefined, text);
    },
  },
}));
