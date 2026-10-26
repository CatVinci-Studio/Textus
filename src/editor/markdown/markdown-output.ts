import type { Ctx } from "@milkdown/kit/ctx";
import { defaultValueCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import { codeBlockSchema, imageSchema } from "@milkdown/kit/preset/commonmark";
import { remarkGFMPlugin } from "@milkdown/kit/preset/gfm";
import type { DOMOutputSpec } from "@milkdown/kit/prose/model";
import type { List, ListItem, Parents } from "mdast";
import {
  defaultHandlers,
  type Handle,
  type Unsafe,
} from "mdast-util-to-markdown";
import { referenceFor, type LinkReference } from "./reference-links";
import {
  imageMarkdownHtml,
  imageWidthOf,
  readImagePresentation,
  type ImageAttrs,
} from "../images/image-html";
import {
  type PeekingHandle,
  isAutolinkLiteralGuard,
  keepLinkAcrossInlineNodes,
  link,
} from "./link-output";
import {
  type Phrasing,
  alternateNestedMarkers,
  encodeAroundAttention,
  joinAdjacent,
  underscoresAtWordEdges,
  withInlineMathAsWritten,
  withMathBlockAsWritten,
  withTildesAsWritten,
} from "./span-output";
import {
  displayWidth,
  documentBreaks,
  escapingBeforeSpaces,
  hardBreak,
  hardBreakAsSpaces,
  keepAlertMarker,
  markLatexAhead,
  withSingleLineEnds,
  withoutLatexPairs,
} from "./text-output";
export {
  type LinkSyntax,
  linkSyntaxOf,
  linked,
  firstLink,
  linksOnSpansIn,
  linksOnSpansSerializer,
} from "./link-output";
export { documentBreaks, displayWidth } from "./text-output";
// How the editor writes markdown back out: every rule keeps a saved file
// close to what the user wrote, not remark-stringify's house style.

/**
 * A thematic break is "---", except as the first block, where it stays
 * "***": a leading "---" would open frontmatter on reopening, and the
 * handler's output bypasses escaping.
 */
const thematicBreak: Handle = (node, parent) => {
  const isFirstBlock = parent?.type === "root" && parent.children[0] === node;
  // In a list item it is "___": after the marker a rule of the marker's
  // character makes the line a rule, and "---" under a paragraph underlines it.
  if (isFirstBlock) return "***";
  return parent?.type === "listItem" ? "___" : "---";
};

/**
 * Milkdown stores list `spread` as the strings "true"/"false", and "false"
 * is truthy, so tight bullet lists were written loose. Fixed in the list
 * handler, since listItem is remark-gfm's (it writes "[ ]").
 */
const toBoolean = (spread: unknown) => spread === true || spread === "true";

/**
 * An item whose first paragraph is empty but has more after it is written
 * with the next block on the marker's line: a marker alone and a blank line
 * would end the item there. A task item keeps it.
 */
function withoutEmptyLead(item: ListItem): void {
  const [first, ...rest] = item.children;
  if (
    typeof item.checked !== "boolean" &&
    rest.length > 0 &&
    first.type === "paragraph" &&
    !(first.children as unknown[] | undefined)?.length
  )
    item.children = rest;
}

/**
 * Whether `node` is a list right under a paragraph of a tight item. An
 * empty item can't interrupt a paragraph, so its first item is written with
 * a space as a character reference.
 */
function interruptsParagraph(node: List, parent: Parents | undefined) {
  const siblings = (parent?.children ?? []) as Phrasing[];
  return (
    parent?.type === "listItem" &&
    !toBoolean(parent.spread) &&
    siblings[siblings.indexOf(node as never) - 1]?.type === "paragraph"
  );
}

const list: Handle = (node, parent, state, info) => {
  node.spread = toBoolean(node.spread);
  for (const item of node.children) {
    item.spread = toBoolean(item.spread);
    withoutEmptyLead(item);
  }
  const listItem = state.handlers.listItem;
  const tasks = withEmptyTasks(listItem);
  const first = interruptsParagraph(node, parent) ? node.children[0] : null;
  state.handlers.listItem = (item, itemParent, itemState, itemInfo) => {
    const out = tasks(item, itemParent, itemState, itemInfo);
    return item === first && /^(?:[*+-]|\d+[.)])$/.test(out)
      ? `${out} &#x20;`
      : out;
  };
  try {
    return defaultHandlers.list(node, parent, state, info);
  } finally {
    state.handlers.listItem = listItem;
  }
};

/**
 * Writes a task item with no text yet as `- [ ] `: remark-gfm puts the box
 * after the bullet's following space, which an empty item lacks, so the box
 * was dropped or landed on the next line.
 */
function withEmptyTasks(listItem: Handle): Handle {
  return (node, parent, state, info) => {
    const head = node.children[0];
    const empty =
      typeof node.checked === "boolean" &&
      // Milkdown hands an empty paragraph over with no `children` at all.
      (!head ||
        (head.type === "paragraph" &&
          !(head.children as unknown[] | undefined)?.length));
    if (!empty) return listItem(node, parent, state, info);
    const plain = listItem({ ...node, checked: null }, parent, state, info);
    return plain.replace(
      /^([*+-]|\d+[.)])/,
      `$1 [${node.checked ? "x" : " "}] `,
    );
  };
}

/**
 * The image node with a width and the `<img>` tag it was read from. From
 * HTML its title comes from `title` alone: Milkdown's alt fallback turned a
 * pasted `![alt](src)` into `![alt](src "alt")`. Only the editor's own
 * images carry `data-width`.
 */
function configureImageNode(ctx: Ctx): void {
  ctx.update(imageSchema.key, (prev) => (innerCtx) => {
    const schema = prev(innerCtx);
    return {
      ...schema,
      attrs: {
        ...schema.attrs,
        width: { default: "", validate: "string" },
        html: { default: "", validate: "string" },
        reference: { default: "", validate: "string" },
      },
      parseDOM: [
        {
          tag: "img[src]",
          getAttrs: (dom) =>
            dom instanceof HTMLElement && {
              src: dom.getAttribute("src") ?? "",
              alt: dom.getAttribute("alt") ?? "",
              title: dom.getAttribute("title") ?? "",
              width: dom.dataset.width ?? "",
            },
        },
      ],
      // The stock toDOM spreads every attr onto the <img>; the tag's source isn't
      // one. The width shows in another app it's pasted into.
      toDOM: (node) => {
        const { src, alt } = node.attrs as ImageAttrs;
        const { title } = readImagePresentation(node.attrs.title as string);
        const width = imageWidthOf(node.attrs);
        return [
          "img",
          width
            ? { src, alt, title, width, "data-width": width }
            : { src, alt, title },
        ];
      },
      parseMarkdown: {
        match: schema.parseMarkdown.match,
        runner: (state, node, type) => {
          const data = node.data as {
            width?: string;
            html?: string;
            reference?: LinkReference;
          } | null;
          state.addNode(type, {
            src: node.url as string,
            alt: (node.alt as string | null) ?? "",
            title: (node.title as string | null) ?? "",
            width: data?.width ?? "",
            html: data?.html ?? "",
            reference: data?.reference ? JSON.stringify(data.reference) : "",
          });
        },
      },
      toMarkdown: {
        match: schema.toMarkdown.match,
        runner: (state, node) => {
          const attrs = node.attrs as ImageAttrs;
          const html = imageMarkdownHtml(attrs);
          const written =
            html === null &&
            referenceFor(node.attrs.reference, attrs.src, attrs.title);
          if (written)
            state.addNode("imageReference", undefined, undefined, {
              ...written,
              alt: attrs.alt,
            });
          else if (html === null)
            state.addNode("image", undefined, undefined, {
              title: attrs.title,
              url: attrs.src,
              alt: attrs.alt,
            });
          else if (!unwrittenImageSrcs.has(attrs.src))
            state.addNode("html", undefined, html);
        },
      },
    };
  });
}

/**
 * A code fence's info string past the language (```` ```js title="a.js" ````)
 * kept in a `meta` attr; Milkdown keeps only the language.
 */
function keepCodeFenceMeta(ctx: Ctx): void {
  ctx.update(codeBlockSchema.key, (prev) => (innerCtx) => {
    const schema = prev(innerCtx);
    return {
      ...schema,
      attrs: { ...schema.attrs, meta: { default: "", validate: "string" } },
      parseDOM: [
        {
          tag: "pre",
          preserveWhitespace: "full",
          getAttrs: (dom) =>
            dom instanceof HTMLElement && {
              language: dom.dataset.language ?? "",
              meta: dom.dataset.meta ?? "",
            },
        },
      ],
      toDOM: (node) => {
        // Kept on the <pre> for a copy and paste inside the editor.
        const [tag, attrs, ...rest] = schema.toDOM!(node) as [
          string,
          Record<string, unknown>,
          ...DOMOutputSpec[],
        ];
        const meta = node.attrs.meta as string;
        return [tag, meta ? { ...attrs, "data-meta": meta } : attrs, ...rest];
      },
      parseMarkdown: {
        match: schema.parseMarkdown.match,
        runner: (state, node, type) => {
          state.openNode(type, {
            language: (node.lang as string | null) ?? "",
            meta: (node.meta as string | null) ?? "",
          });
          if (node.value) state.addText(node.value as string);
          state.closeNode();
        },
      },
      toMarkdown: {
        match: schema.toMarkdown.match,
        runner: (state, node) => {
          state.addNode(
            "code",
            undefined,
            node.content.firstChild?.text || "",
            {
              lang: node.attrs.language,
              meta: (node.attrs.meta as string) || null,
            },
          );
        },
      },
    };
  });
}

/**
 * Image srcs shown but never written: a pasted screenshot's `blob:` URL
 * while its file is being stored. The swap to the stored path dirties the
 * document, so the next save writes the image.
 */
export const unwrittenImageSrcs = new Set<string>();

const defaultImage = defaultHandlers.image as PeekingHandle;

const image = Object.assign(
  ((node, parent, state, info) =>
    unwrittenImageSrcs.has(node.url)
      ? ""
      : defaultImage(node, parent, state, info)) as Handle,
  {
    peek: ((node, parent, state, info) =>
      unwrittenImageSrcs.has(node.url)
        ? ""
        : defaultImage.peek(node, parent, state, info)) as Handle,
  },
);

/**
 * A "#" at a line's start is escaped only where it would open a heading;
 * remark escaped every one, so `#idea` saved as `\#idea`.
 */
const isHeadingGuard = (pattern: Unsafe) =>
  pattern.character === "#" &&
  pattern.atBreak === true &&
  !pattern.after &&
  !pattern.inConstruct;

const headingGuard: Unsafe = {
  character: "#",
  atBreak: true,
  after: "#{0,5}(?:[ \\t\\r\\n]|$)",
};

/** A "#" ending a heading's text, spaces after it or not, which would close
 *  the heading there. remark's own guard misses the spaces. */
const closingHashGuard: Unsafe = {
  character: "#",
  inConstruct: "headingAtx",
  after: "[ \\t]*(?:[\\r\\n]|$)",
};

/** Set up per serialization, before any node is written. */
const root: Handle = (node, parent, state, info) => {
  joinAdjacent(node as Phrasing);
  underscoresAtWordEdges(node as Phrasing);
  alternateNestedMarkers(node as Phrasing);
  markLatexAhead(node as Phrasing);
  encodeAroundAttention(node as Phrasing);
  state.unsafe = state.unsafe
    .filter((pattern) => !isAutolinkLiteralGuard(pattern))
    .map((pattern) => (isHeadingGuard(pattern) ? headingGuard : pattern))
    .concat(closingHashGuard);
  const del = state.handlers.delete as Handle | undefined;
  if (del) state.handlers.delete = withTildesAsWritten(del);
  const inlineMath = state.handlers.inlineMath as Handle | undefined;
  if (inlineMath)
    state.handlers.inlineMath = withInlineMathAsWritten(inlineMath);
  const math = state.handlers.math as Handle | undefined;
  if (math) state.handlers.math = withMathBlockAsWritten(math);
  return defaultHandlers.root(node, parent, state, info);
};

/**
 * The bullet the document's own lists use, by majority, or null. remark
 * writes "*" whatever the file had, rewriting every bullet on the first edit.
 */
export function documentBullet(markdown: string): "-" | "*" | "+" | null {
  const counts = { "-": 0, "*": 0, "+": 0 };
  for (const match of markdown.matchAll(/^[ \t]*([-*+])[ \t]+\S/gm))
    counts[match[1] as keyof typeof counts]++;
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? (best as "-" | "*" | "+") : null;
}

/** Installs the rules above. `update`, not `set`: replacing the slice would
 *  drop Milkdown's own handlers. */
export function configureMarkdownOutput(ctx: Ctx): void {
  keepLinkAcrossInlineNodes(ctx);
  configureImageNode(ctx);
  keepCodeFenceMeta(ctx);
  ctx.update(remarkGFMPlugin.options.key, (options) => ({
    ...options,
    stringLength: displayWidth,
  }));
  // The editor's opening text, set before this runs.
  const initial = ctx.get(defaultValueCtx);
  const bullet = typeof initial === "string" ? documentBullet(initial) : null;
  const breaks =
    typeof initial === "string" ? documentBreaks(initial) : "backslash";
  ctx.update(remarkStringifyOptionsCtx, (options) => ({
    ...options,
    ...(bullet ? { bullet } : {}),
    handlers: {
      ...options.handlers,
      root,
      thematicBreak,
      list,
      link,
      image,
      break: breaks === "spaces" ? hardBreakAsSpaces : hardBreak,
      text: withSingleLineEnds(
        withoutLatexPairs(
          keepAlertMarker(
            escapingBeforeSpaces(
              (options.handlers?.text as Handle | undefined) ??
                defaultHandlers.text,
            ),
          ),
        ),
      ),
    },
  }));
}
