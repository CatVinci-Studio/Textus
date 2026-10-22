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
// How the editor writes markdown back out. Every rule here exists to keep a
// saved file close to what the user wrote, instead of remark-stringify's
// house style.

/**
 * Serializes a thematic break as "---", except as the document's very first
 * block, where it stays "***".
 *
 * A leading "---" is the frontmatter OPENING fence: remark-frontmatter
 * (frontmatter-schema.ts) would then take the next "---" in the file as the
 * closing one and swallow everything between them into a YAML block the next
 * time the file is opened. remark-frontmatter does register an unsafe pattern
 * against exactly this, but mdast-util-to-markdown never runs a thematic
 * break through its escaping - the handler's return value is used verbatim -
 * so the one ambiguous position has to avoid the dash form itself.
 */
const thematicBreak: Handle = (node, parent) => {
  const isFirstBlock = parent?.type === "root" && parent.children[0] === node;
  // In a list item it is "___": right after the marker, a rule of the
  // marker's character makes the whole line a rule (`- ---`, `* ***`), and
  // in a tight item "---" on the line under a paragraph underlines it into
  // a heading.
  if (isFirstBlock) return "***";
  return parent?.type === "listItem" ? "___" : "---";
};

/**
 * Milkdown stores list and list-item `spread` as the STRINGS "true" /
 * "false" and hands bullet lists and list items to remark as-is (ordered
 * lists alone compare `=== "true"`). "false" is truthy, so every tight
 * bullet list - and every item with a nested list - was written back loose,
 * a blank line between each item, the first time a file was saved.
 *
 * Fixed in the list handler, items included, rather than by also replacing
 * listItem: that handler is remark-gfm's (it writes the task-list "[ ]"),
 * and a listItem here would override it.
 */
const toBoolean = (spread: unknown) => spread === true || spread === "true";

/**
 * An item whose first paragraph is empty but has more after it - its line
 * deleted, or one that opened with indented code (the editor's items start
 * with a paragraph) - is written with the next block on the marker's line.
 * Written as it was, a marker alone on its line and a blank line, the item
 * ended there: `-\n\n  bar` is an empty item and a paragraph after the
 * list. A task item keeps it; withEmptyTasks below writes that one.
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
 * Whether `node` is a list right under a paragraph of a tight item,
 * `* PHP\n  * Symfony`. An empty item can't interrupt a paragraph in
 * CommonMark, so with its only word deleted the first item's bullet read
 * back as text, "PHP *". That item is written with a space as a character
 * reference, which reads back as an item with nothing to show.
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
 * Writes a task item with no text yet as `- [ ] `. remark-gfm's handler
 * puts the box after the bullet's following space, and an empty item has
 * none: the box was dropped (a plain "-" saved), or - with a nested list
 * under it - landed at the start of the next line, "[x]   - child", which
 * reads back as a different document. The box is written here instead,
 * around remark-gfm's handler (which this wraps for the one list, so its
 * handling of every other item stays), and read back by
 * remarkEmptyTaskItems (task-list-plugin.ts).
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
 * The image node, with a width and the `<img>` tag it was read from
 * (images/image-html.ts): a sized image is saved as `<img width>`, and a
 * tag nobody changed as it was written.
 *
 * An image read from HTML takes its title from `title` alone. Milkdown's
 * parseDOM falls back to the alt, and its clipboard plugin pastes plain
 * text by parsing it as markdown, drawing it as HTML and reading that back -
 * so a pasted `![alt](src)` was saved as `![alt](src "alt")` (issue #189).
 * Its width comes back from `data-width`, which only the editor's own
 * images carry: a picture pasted from a web page, sized for that page,
 * stays `![]()`.
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
        // How a reference image was written (reference-links.ts).
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
      // The stock toDOM spreads every attr onto the <img>; the tag's
      // source isn't one. The width shows in another app it's pasted into,
      // one an older Textus kept in the title included (and not the title).
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
 * A code fence's info string past the language - ```` ```js title="a.js" ````
 * - kept in a `meta` attr and written back. Milkdown's code block keeps
 * only the language, so the rest was dropped on the first save, and with
 * it the file names and line highlights other tools draw from it.
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
 * Image srcs that are shown but never written: a pasted screenshot's
 * `blob:` URL while its file is still being stored (image-plugin.ts).
 * A blob: URL names memory of this page alone, so a save made in that
 * window wrote an image that was gone on reopen (issue #59's failure).
 * Left out instead; the swap to the stored path changes the document
 * again, so it is dirty and the next save writes the image.
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
 * A "#" at the start of a line is escaped only where it would open a
 * heading: up to six of them followed by a space, a tab or the line's end.
 * remark escaped every one, so an Obsidian tag, `#idea`, was saved as
 * `\#idea`.
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

/** A "#" ending a heading's text, spaces after it or not: `### foo ###`
 *  closes the heading there, and the text loses its "###". remark's own
 *  guard misses the spaces (escapingBeforeSpaces hands them over). */
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
 * The bullet the document's own lists use ("-", "*" or "+"), by majority,
 * or null when it has none. remark writes "*" whatever the file had, so
 * the first edit to a README written with "-" rewrote every bullet in it
 * and the file's diff ran to hundreds of lines.
 */
export function documentBullet(markdown: string): "-" | "*" | "+" | null {
  const counts = { "-": 0, "*": 0, "+": 0 };
  for (const match of markdown.matchAll(/^[ \t]*([-*+])[ \t]+\S/gm))
    counts[match[1] as keyof typeof counts]++;
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? (best as "-" | "*" | "+") : null;
}

/** Installs the rules above. `update`, not `set`: the slice already carries
 *  Milkdown's own text/strong/emphasis handlers, and replacing it wholesale
 *  would drop them. */
export function configureMarkdownOutput(ctx: Ctx): void {
  keepLinkAcrossInlineNodes(ctx);
  configureImageNode(ctx);
  keepCodeFenceMeta(ctx);
  ctx.update(remarkGFMPlugin.options.key, (options) => ({
    ...options,
    stringLength: displayWidth,
  }));
  // The editor's opening text (MilkdownEditor sets it before this runs).
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
