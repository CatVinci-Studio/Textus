import {
  Fragment,
  type DOMOutputSpec,
  type Node as ProseNode,
} from "@milkdown/kit/prose/model";
import { escapeCellPipes } from "../tables/cell-pipes";
import { $nodeSchema, $remark } from "@milkdown/kit/utils";
import type { RemarkPluginRaw } from "@milkdown/kit/transformer";
import type {
  Handle,
  Options as ToMarkdownExtension,
} from "mdast-util-to-markdown";
import type { Literal, Parents } from "mdast";
import {
  escapeLabel,
  labelMarkdown,
  labelNodes,
  labelText,
} from "./link-label";
import { inlineLink, linkHref, linkSource, parseLink } from "./link-syntax";

/**
 * A link is a node holding its Markdown as text, `[text](url "title")`,
 * `<url>`, `[text][ref]` or a bare URL, the way a wikilink holds `[[Note]]`:
 * a save writes that text back, and the reveal plugin hides its syntax
 * while the caret is away.
 */

export const LINK = "link";

/** A link's source as mdast, for the serializer. */
interface LinkSourceNode extends Literal {
  type: "linkSource";
}

declare module "mdast" {
  interface PhrasingContentMap {
    linkSource: LinkSourceNode;
  }
  interface RootContentMap {
    linkSource: LinkSourceNode;
  }
}

interface Phrasing {
  type: string;
  value?: string;
  url?: string;
  children?: Phrasing[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  data?: Record<string, unknown>;
}

const textOf = (node: Phrasing): string =>
  node.value ?? (node.children ?? []).map(textOf).join("");

/** Each link's source text onto its mdast node as `data.source`. A link
 *  over several lines of a quote or list loses their line prefixes. */
const remarkLinkSource: RemarkPluginRaw<unknown> = function (
  this: ThisParameterType<RemarkPluginRaw<unknown>>,
) {
  const data = this.data();
  (data.toMarkdownExtensions ??= []).push(linkSourceToMarkdown);
  return (tree, file) => {
    const text = String((file as { value?: unknown }).value ?? "");
    const walk = (node: Phrasing) => {
      if (node.type === "link" || node.type === "linkReference") {
        const start = node.position?.start?.offset;
        const end = node.position?.end?.offset;
        if (start !== undefined && end !== undefined && end > start)
          node.data = {
            ...node.data,
            source: text.slice(start, end).replace(/\n[ \t>]*/g, "\n"),
          };
        return;
      }
      node.children?.forEach(walk);
    };
    walk(tree as Phrasing);
  };
};

/** What is written right after `node` in its paragraph as text; anything
 *  else is "\ufffc". A line break ends it. */
function textAfter(node: Phrasing, parent: Parents | undefined): string {
  const siblings = (parent?.children ?? []) as Phrasing[];
  let rest = "";
  for (const next of siblings.slice(siblings.indexOf(node) + 1)) {
    if (next.type === "text") {
      rest += next.value ?? "";
      continue;
    }
    if (next.type !== "break") rest += "\ufffc";
    break;
  }
  return rest;
}

/** Whether a GFM link literal ends where `rest` starts: at white space or
 *  the line's end, after only trailing punctuation. */
const endsAddress = (rest: string) => /^[.,:;!?"')]*(?:\s|$)/u.test(rest);

/** The source as written, but a bare URL that text was put against as
 *  `[url](href)`: bare, it would read back longer, or as text. */
function asWritten(node: LinkSourceNode, parent: Parents | undefined): string {
  const { value } = node;
  if (parseLink(value)?.kind !== "bare") return value;
  const siblings = (parent?.children ?? []) as Phrasing[];
  const before = siblings[siblings.indexOf(node as Phrasing) - 1];
  const glued =
    (before?.type === "text" && /[^\s*_~(]$/.test(before.value ?? "")) ||
    !endsAddress(textAfter(node as Phrasing, parent));
  return glued ? `[${value}](${linkHref(value)})` : value;
}

/** Written as it is: in a table cell, with its `|`s escaped. */
const writeLinkSource = Object.assign(
  ((node: LinkSourceNode, parent, state) => {
    const value = asWritten(node, parent);
    return state.stack.includes("tableCell") ? escapeCellPipes(value) : value;
  }) as Handle,
  // containerPhrasing asks which character it starts with, to escape a "!"
  // written right before it.
  {
    peek: ((node: LinkSourceNode, parent) =>
      asWritten(node, parent).charAt(0)) as Handle,
  },
);

const linkSourceToMarkdown: ToMarkdownExtension = {
  handlers: { linkSource: writeLinkSource },
};

export const remarkLinkSourcePlugin = $remark(
  "remark-link-source",
  () => remarkLinkSource,
);

/** A link on the clipboard: an <a> another app reads as one, its label as
 *  the text, with the source for pasting back here. */
export function linkClipboardDOM(node: ProseNode): DOMOutputSpec {
  const source = node.textContent;
  const parts = parseLink(source);
  const href = linkHref(source);
  if (!parts || href === null) return ["span", source];
  const a = document.createElement("a");
  a.href = href;
  if (parts.title) a.title = parts.title;
  a.dataset.type = LINK;
  a.dataset.source = source;
  const label = source.slice(...parts.label);
  if (label && parts.kind !== "bare" && parts.kind !== "autolink")
    a.append(...labelNodes(label));
  else a.textContent = label || href;
  return a;
}

export const linkSchema = $nodeSchema(LINK, () => ({
  content: "text*",
  group: "inline",
  inline: true,
  marks: "",
  // Source, like a wikilink: "*" typed in a URL is not bold.
  code: true,
  attrs: {},
  parseDOM: [
    {
      tag: `a[data-type="${LINK}"]`,
      preserveWhitespace: "full" as const,
      priority: 60,
      // Copied, it carries its source beside the text other apps show.
      getContent: (dom, schema) => {
        const el = dom as HTMLElement;
        const source = el.dataset.source ?? el.textContent ?? "";
        return Fragment.from(source ? schema.text(source) : []);
      },
    },
    // A link from anywhere else, as its Markdown.
    {
      tag: "a[href]",
      getContent: (dom, schema) => {
        const el = dom as HTMLElement;
        const href = el.getAttribute("href") ?? "";
        const label = labelMarkdown(el).trim();
        return Fragment.from(
          schema.text(inlineLink(label || escapeLabel(href), href, el.title)),
        );
      },
    },
  ],
  toDOM: () => ["a", { "data-type": LINK, class: "md-link" }, 0],
  parseMarkdown: {
    match: (node) => node.type === "link" || node.type === "linkReference",
    runner: (state, node, type) => {
      const source =
        (node.data as { source?: string } | undefined)?.source ??
        linkSource(textOf(node as Phrasing), (node.url as string) ?? "");
      state.addNode(type, undefined, [state.schema.text(source)]);
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === LINK,
    runner: (state, node) => {
      if (node.textContent)
        state.addNode("linkSource", undefined, node.textContent);
    },
  },
}));

/** What `node` reads as: its text with each link as its label, as headings'
 *  ids and the table of contents use it. */
export function shownText(node: ProseNode): string {
  let text = "";
  node.descendants((child) => {
    if (child.type.name === LINK) {
      const source = child.textContent;
      const parts = parseLink(source);
      text += parts
        ? labelText(source.slice(...parts.label)) || parts.dest
        : source;
      return false;
    }
    if (child.isText) text += child.text;
    return true;
  });
  return text;
}
