import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import {
  SerializerReady,
  defaultValueCtx,
  remarkStringifyOptionsCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import {
  codeBlockSchema,
  imageSchema,
  linkSchema,
} from "@milkdown/kit/preset/commonmark";
import { Fragment } from "@milkdown/kit/prose/model";
import type {
  DOMOutputSpec,
  Mark,
  Node as ProseNode,
} from "@milkdown/kit/prose/model";
import type { MarkdownNode } from "@milkdown/kit/transformer";
import type { Link, List, ListItem, Parents } from "mdast";
import {
  defaultHandlers,
  type Handle,
  type State,
  type Unsafe,
} from "mdast-util-to-markdown";
import { referenceFor, type LinkReference } from "./reference-links";
import {
  imageMarkdownHtml,
  imageWidthOf,
  readImagePresentation,
  type ImageAttrs,
} from "../images/image-html";
import { isEmptySpan } from "../marks/md-span-schema";
import { writeLatexMath } from "../math/latex-math-syntax";

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
 * Which markdown syntax a link was written in, kept on the mark so a save
 * writes it back the same way. remark-stringify picks the form from the
 * content alone: any link whose text equals its URL came out as
 * `<https://...>`, so a `[https://x](https://x)` the user typed was
 * rewritten on the first save.
 *
 * - "autolink": `<https://...>` or a bare GFM URL - written `<...>`,
 *   remark's choice, which every Markdown tool reads as a link.
 * - "empty": `[](https://...)`. There is no text to put the mark on, so
 *   Milkdown dropped the link altogether: invisible in the editor, and gone
 *   from the file on the next save. It shows its URL as text instead (as
 *   Typora does) and is written back empty while that text is untouched.
 * - "resource": everything else, and every link made in the editor -
 *   a pasted URL included (paste-url.ts).
 */
export type LinkSyntax = "resource" | "autolink" | "empty";

interface Positioned {
  position?: { end?: { offset?: number } };
}

/** Tells the three apart by source position: an autolink's only child ends
 *  at most one character (the `>`) before the link does, while
 *  `[text](url)` always has `](url)` after its text. Without positions the
 *  link is left to remark's default, which is what it always was. */
export function linkSyntaxOf(node: MarkdownNode): LinkSyntax {
  const children = (node.children ?? []) as MarkdownNode[];
  if (children.length === 0) return "empty";
  const end = (node as Positioned).position?.end?.offset;
  const childEnd = (children[children.length - 1] as Positioned).position?.end
    ?.offset;
  if (end === undefined || childEnd === undefined) return "autolink";
  return children.length === 1 && childEnd >= end - 1 ? "autolink" : "resource";
}

/** The visible text of a link, for comparing against its URL. */
function textOf(node: { value?: unknown; children?: unknown[] }): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? [])
    .map((child) => textOf(child as { value?: unknown; children?: unknown[] }))
    .join("");
}

/**
 * Milkdown's parser forgets every open mark whenever it closes a node, so
 * in `[see **this** here](url)` the link only covered "see " and "this":
 * " here" came back as plain text and the URL fell off it on the next save.
 * Re-opening the link before each child keeps it on all of them, whatever
 * node the previous child closed. (Inline code, which keeps its own text
 * unmarked, carries the link on itself - md-span-schema.ts.)
 *
 * The same override carries the link's syntax (LinkSyntax above) into the
 * mark, and through the DOM too, so a link copied and pasted inside the
 * editor keeps it.
 */
function keepLinkAcrossInlineNodes(ctx: Ctx): void {
  ctx.update(linkSchema.key, (prev) => (innerCtx) => {
    const schema = prev(innerCtx);
    return {
      ...schema,
      attrs: {
        ...schema.attrs,
        syntax: { default: "resource", validate: "string" },
        // How a reference link was written (reference-links.ts).
        reference: { default: "", validate: "string" },
      },
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (dom) => {
            if (!(dom instanceof HTMLElement)) return false;
            const syntax = dom.dataset.linkSyntax;
            return {
              href: dom.getAttribute("href"),
              title: dom.getAttribute("title"),
              syntax:
                syntax === "autolink" || syntax === "empty"
                  ? syntax
                  : "resource",
            };
          },
        },
      ],
      toDOM: (mark, inline) => {
        // The stock toDOM spreads every attr onto the <a>, which would add
        // a meaningless syntax="resource" attribute to each link. A
        // reference stays off it too: pasted where its definition isn't, it
        // would link to nothing, so a copy is an ordinary link.
        const attrs: Record<string, unknown> = { ...mark.attrs };
        const { syntax } = mark.attrs;
        delete attrs.syntax;
        delete attrs.reference;
        const [tag, domAttrs] = schema.toDOM!(
          { ...mark, attrs } as typeof mark,
          inline,
        ) as [string, Record<string, unknown>];
        return [
          tag,
          syntax === "resource"
            ? domAttrs
            : { ...domAttrs, "data-link-syntax": syntax },
        ];
      },
      parseMarkdown: {
        match: schema.parseMarkdown.match,
        runner: (state, node, markType) => {
          const reference = (node.data as { reference?: LinkReference })
            ?.reference;
          // `[text]` alone ends one character after its text, as an
          // autolink does.
          const syntax = reference ? "resource" : linkSyntaxOf(node);
          const attrs = {
            href: node.url as string,
            title: node.title as string,
            syntax,
            reference: reference ? JSON.stringify(reference) : "",
          };
          if (syntax === "empty") {
            if (!attrs.href) return; // `[]()` has nothing to show
            state.openMark(markType, attrs);
            state.addText(attrs.href);
            state.closeMark(markType);
            return;
          }
          const content = state.top()!.content;
          const from = content.length;
          for (const child of (node.children ?? []) as MarkdownNode[]) {
            state.openMark(markType, attrs);
            state.next(child);
            state.closeMark(markType);
          }
          // Inside a span the marks are forgotten again: in
          // `[a *b `c`*](u)` the "c" came out unlinked.
          const link = markType.create(attrs);
          for (let i = from; i < content.length; i++)
            content[i] = withLinkInside(content[i], link);
        },
      },
      toMarkdown: {
        match: schema.toMarkdown.match,
        runner: (state, mark) => {
          const { href, title, reference } = mark.attrs;
          const written = referenceFor(reference, href, title);
          if (written)
            state.withMark(mark, "linkReference", undefined, written);
          else
            state.withMark(mark, "link", undefined, {
              title,
              url: href,
              data: { linkSyntax: mark.attrs.syntax },
            });
        },
      },
    };
  });
}

/** Whether `link` is on `node`, or on everything inside it. */
function linked(node: ProseNode, link: Mark): boolean {
  if (link.isInSet(node.marks)) return true;
  if (node.isLeaf) return false;
  // An emptied span inside holds nothing to be outside the link.
  let all = true;
  node.forEach((child) => {
    all &&= linked(child, link);
  });
  return all;
}

/** The link on the first text in `node`, nested spans and all. */
function firstLink(node: ProseNode): Mark | undefined {
  let found: Mark | undefined;
  node.descendants((child) => {
    found ??= child.marks.find((mark) => mark.type.name === "link");
    return !found && !child.isText;
  });
  return found;
}

function withoutMark(content: Fragment, link: Mark): Fragment {
  const nodes: ProseNode[] = [];
  content.forEach((node) => {
    const marks = link.removeFromSet(node.marks);
    nodes.push(
      node.isText
        ? node.mark(marks)
        : node.type.create(node.attrs, withoutMark(node.content, link), marks),
    );
  });
  return Fragment.from(nodes);
}

/** Inline content with the link moved onto each bold or italic span that
 *  stands inside it; null when there is none. */
function linksOnSpansIn(content: Fragment): Fragment | null {
  let changed = false;
  const nodes: ProseNode[] = [];
  content.forEach((node, _offset, index) => {
    // An emptied span writes nothing, and isn't left to end the link.
    if (isEmptySpan(node)) {
      changed = true;
      return;
    }
    let next = node;
    const inner = node.isText ? null : linksOnSpansIn(node.content);
    if (inner) next = node.copy(inner);
    if (next.type.name === "md_span" && next.childCount > 0) {
      const link = firstLink(next);
      const neighbours = [
        content.maybeChild(index - 1),
        content.maybeChild(index + 1),
      ];
      if (
        link &&
        !link.isInSet(next.marks) &&
        linked(next, link) &&
        neighbours.some(
          (side) => side && side.textContent !== "" && linked(side, link),
        )
      )
        next = next.type.create(
          next.attrs,
          withoutMark(next.content, link),
          link.addToSet(next.marks),
        );
    }
    if (next !== node) changed = true;
    nodes.push(next);
  });
  return changed ? Fragment.from(nodes) : null;
}

function linksOnSpans(node: ProseNode): ProseNode {
  if (node.isTextblock) {
    const content = linksOnSpansIn(node.content);
    return content ? node.copy(content) : node;
  }
  if (node.isLeaf) return node;
  let changed = false;
  const children: ProseNode[] = [];
  node.forEach((child) => {
    const next = linksOnSpans(child);
    if (next !== child) changed = true;
    children.push(next);
  });
  return changed ? node.copy(Fragment.from(children)) : node;
}

/**
 * Serializes a link around bold or italic as one link. Its marks are on
 * the text only, `[a **b** c](u)` being "a ", a span holding "b", and " c",
 * all linked; Milkdown's serializer closes a mark at a node that doesn't
 * carry it, so the link was written as three, `[a](u) **[b](u)** [c](u)`,
 * once anything in that paragraph was edited. Here a span whose content is
 * all inside a link that goes on beside it carries the link itself, as
 * inline code does (md-span-schema.ts writes the span's content apart).
 * A span that is a whole link of its own, `**[b](u)**`, stays as it is.
 */
export const linksOnSpansSerializer: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(SerializerReady);
  const serialize = ctx.get(serializerCtx);
  ctx.set(serializerCtx, (doc) => serialize(linksOnSpans(doc)));
};

/** `node` with `link` on all its text: on the text inside a span, and on
 *  a node whose own content takes no marks (inline code), on the node. */
function withLinkInside(node: ProseNode, link: Mark): ProseNode {
  if (node.isText || node.isLeaf || node.type.spec.marks === "")
    return node.mark(link.addToSet(node.marks));
  const children: ProseNode[] = [];
  node.forEach((child) => children.push(withLinkInside(child, link)));
  return node.copy(Fragment.from(children));
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
 * Runs one of remark's link functions with its `resourceLink` switch ("never
 * <...>") set the way this link's syntax asks. The option is shared by the
 * whole serialization, so it is set only around the one call.
 */
function asWritten<T>(
  node: { data?: unknown },
  state: State,
  write: () => T,
): T {
  const syntax = (node.data as { linkSyntax?: LinkSyntax } | undefined)
    ?.linkSyntax;
  if (syntax === "autolink") return write();
  const previous = state.options.resourceLink;
  state.options.resourceLink = true;
  try {
    return write();
  } finally {
    state.options.resourceLink = previous;
  }
}

type PeekingHandle = Handle & { peek: Handle };
const defaultLink = defaultHandlers.link as PeekingHandle;

/** A bare `www.x.org`, which GFM links with an `http://` URL. It has no
 *  `<...>` form - remark wrote `[www.x.org](http://www.x.org)` - and,
 *  written bare as it was, it reads back the same (see `root` below).
 *  Not with text right after it, which would read as more of the address
 *  (`www.x.orgPasted`), nor with punctuation and then text
 *  (`www.x.org/a.b.Pasted`: GFM leaves out only punctuation at the end):
 *  then it is written `[www.x.org](http://www.x.org)`. */
function bareWww(node: Link, parent: Parents | undefined): string | null {
  const syntax = (node.data as { linkSyntax?: LinkSyntax } | undefined)
    ?.linkSyntax;
  const text = textOf(node);
  return syntax === "autolink" &&
    /^www\./i.test(text) &&
    node.url === `http://${text}` &&
    endsAddress(textAfter(node, parent))
    ? text
    : null;
}

/** What is written right after `node` in its paragraph, as far as its
 *  text goes; anything else after it is "\uFFFC". A line break ends it. */
function textAfter(node: Link, parent: Parents | undefined): string {
  const siblings = (parent?.children ?? []) as Phrasing[];
  let rest = "";
  for (const next of siblings.slice(siblings.indexOf(node as never) + 1)) {
    if (next.type === "text") {
      rest += next.value ?? "";
      continue;
    }
    if (next.type !== "break") rest += "\uFFFC";
    break;
  }
  return rest;
}

/** Whether a GFM link literal ends where `rest` starts: at white space
 *  or the line's end, after only the punctuation GFM leaves off the end of
 *  an address. Not at `<`, which also ends one but is written `\<` before
 *  a letter, and the backslash reads as more of the address; nor after
 *  punctuation the text would write escaped. */
const endsAddress = (rest: string) => /^[.,:;!?"')]*(?:\s|$)/u.test(rest);

/** Writes a link in the syntax it was read in (LinkSyntax above). */
const link = Object.assign(
  ((node, parent, state, info) => {
    const www = bareWww(node, parent);
    if (www) return www;
    const empty =
      (node.data as { linkSyntax?: LinkSyntax } | undefined)?.linkSyntax ===
      "empty";
    // Once its shown URL is edited, an empty link is an ordinary one.
    const written =
      empty && textOf(node) === node.url ? { ...node, children: [] } : node;
    return asWritten(node, state, () =>
      defaultLink(written, parent, state, info),
    );
  }) as Handle,
  {
    // containerPhrasing asks `peek` which character the link starts with.
    peek: ((node, parent, state, info) =>
      bareWww(node, parent)?.charAt(0) ??
      asWritten(node, state, () =>
        defaultLink.peek(node, parent, state, info),
      )) as Handle,
  },
);

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
 * A URL or email address typed as plain text is written as typed. remark-gfm
 * escapes the character that would make GitHub link it - `https\://x.org`,
 * `www\.x.org`, `a\@b.com` - to keep it text, so the address the user
 * typed was no longer a link on GitHub, and read wrongly anywhere the
 * escape isn't understood. Unescaped, it is the autolink GitHub (and
 * Textus, once reopened) makes of it, which is what typing one means;
 * `link` above writes that autolink back the way it was typed.
 * The guards are dropped from this one serialization's own copy of the
 * unsafe list.
 */
const isAutolinkLiteralGuard = (pattern: Unsafe) =>
  (pattern.character === "@" && pattern.before === "[+\\-.\\w]") ||
  (pattern.character === "." && pattern.before === "[Ww]") ||
  (pattern.character === ":" && pattern.before === "[ps]");

/**
 * Writes a strikethrough with as many tildes as it was read with (see
 * remarkStrikethroughTildes in md-span-schema.ts): `~x~` stays single. It
 * wraps whichever `delete` handler the extensions installed - the
 * CJK-friendly one - for this one serialization, as `list` does listItem.
 */
function withTildesAsWritten(del: Handle): Handle {
  return Object.assign(
    ((node, parent, state, info) => {
      const out = del(node, parent, state, info);
      const single = (node.data as { tildes?: number } | undefined)?.tildes;
      return single === 1 && out.startsWith("~~") && out.endsWith("~~")
        ? `~${out.slice(2, -2)}~`
        : out;
    }) as Handle,
    { peek: (del as Partial<PeekingHandle>).peek },
  );
}

type MathData = { mathDelimiter?: string; oneLine?: boolean } | undefined;

/**
 * Writes inline math in the delimiter it was read with - remark-math writes
 * the fewest dollars that work: as many dollars as the file had (see
 * recordDollarRuns in math-schema.ts), so an inline `$$x$$` stays as it
 * was, or LaTeX's `\(x\)` / `\[x\]` (latex-math-syntax.ts). Wraps
 * remark-math's handler for this one serialization, as above.
 */
function withInlineMathAsWritten(inlineMath: Handle): Handle {
  const latex = (node: { value?: string; data?: unknown }) => {
    const wanted = (node.data as MathData)?.mathDelimiter;
    return wanted ? writeLatexMath(node.value ?? "", wanted, false) : null;
  };
  const peek = (inlineMath as Partial<PeekingHandle>).peek;
  return Object.assign(
    ((node, parent, state, info) => {
      const written = latex(node);
      if (written) return written;
      const out = inlineMath(node, parent, state, info);
      const wanted = (node.data as MathData)?.mathDelimiter;
      const used = /^\$+/.exec(out)?.[0] ?? "";
      return wanted && /^\$+$/.test(wanted) && wanted.length > used.length
        ? wanted + out.slice(used.length, out.length - used.length) + wanted
        : out;
    }) as Handle,
    {
      peek: ((node, parent, state, info) =>
        latex(node) ? "\\" : peek?.(node, parent, state, info)) as Handle,
    },
  );
}

/** A math block read as `\[...\]` is written that way again, on one line
 *  or with the delimiters on lines of their own, as it was. */
function withMathBlockAsWritten(math: Handle): Handle {
  return ((node, parent, state, info) => {
    const data = node.data as MathData;
    const written =
      data?.mathDelimiter &&
      writeLatexMath(node.value ?? "", data.mathDelimiter, !data.oneLine);
    return written || math(node, parent, state, info);
  }) as Handle;
}

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

interface Phrasing {
  type: string;
  data?: unknown;
  value?: string;
  children?: Phrasing[];
  /** The delimiter Milkdown's strong and emphasis handlers write. */
  marker?: string;
}

const SPANS = new Set(["strong", "emphasis", "delete", "mark"]);

/** Inline math written between dollars, not LaTeX's `\\(...\\)`. */
const inDollars = (node: Phrasing | undefined) =>
  node?.type === "inlineMath" &&
  !(node.data as MathData)?.mathDelimiter?.startsWith("\\");

/**
 * Inline nodes that can't stand side by side in Markdown - left so when
 * the words between them were deleted - written so they read back:
 *
 * - Two spans of one kind become one: `**foo****bar**` reads back as text
 *   with eight asterisks in it, not as bold.
 * - Two code spans become one: in `` `a``b` `` the second's opening
 *   backtick runs into the first's closing one, and the code reads "a``b".
 * - Two formulas get a space between them: `$a$$b$` reads as one formula,
 *   "a$$b", and the text after it swallowed into maths.
 */
function joinAdjacent(node: Phrasing): void {
  if (!node.children) return;
  const children: Phrasing[] = [];
  for (const child of node.children) {
    const last = children.at(-1);
    if (
      last?.type === child.type &&
      SPANS.has(child.type) &&
      JSON.stringify(last.data) === JSON.stringify(child.data)
    )
      children[children.length - 1] = {
        ...last,
        children: [...(last.children ?? []), ...(child.children ?? [])],
      };
    else if (last?.type === "inlineCode" && child.type === "inlineCode")
      children[children.length - 1] = {
        ...last,
        value: (last.value ?? "") + (child.value ?? ""),
      };
    else {
      if (inDollars(last) && inDollars(child))
        children.push({ type: "text", value: " " });
      children.push(child);
    }
  }
  node.children = children;
  children.forEach(joinAdjacent);
}

/** The first or last character a node is written with, nested spans and
 *  all. A link, an image, code or maths starts and ends with punctuation
 *  (`[`, `)`, a backtick, `$`), whatever is inside. */
function edgeCharacter(node: Phrasing, end: "first" | "last"): string {
  if (node.type === "text") {
    const chars = [...(node.value ?? "")];
    return (end === "first" ? chars[0] : chars.at(-1)) ?? "";
  }
  if (!ATTENTION.has(node.type)) return node.type === "break" ? "" : ".";
  return innerEdgeCharacter(node, end);
}

/** The first or last character of a span's text, inside its delimiters. */
function innerEdgeCharacter(span: Phrasing, end: "first" | "last"): string {
  if (!span.children?.length) return "";
  const child = span.children[end === "first" ? 0 : span.children.length - 1];
  // A span inside written with other delimiters doesn't join this one's.
  return ATTENTION.has(child.type) && child.marker === "_"
    ? "_"
    : edgeCharacter(child, end);
}

const ATTENTION = new Set(["strong", "emphasis"]);
/** Spans whose delimiters open and close by the same rule as bold's:
 *  GFM's strikethrough and the highlight (highlight-syntax.ts). */
const FLANKED = new Set([...ATTENTION, "delete", "mark"]);
const PUNCTUATION = /^[\p{P}\p{S}]$/u;
// CJK text is read by remark-cjk-friendly, which lets bold stand against it.
const WORD =
  /^(?![\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}])[\p{L}\p{N}]$/u;

/** `text` with its first or last character as a character reference, an
 *  inline HTML node (which is written as it is), and the rest. */
function referenced(text: Phrasing, end: "first" | "last"): Phrasing[] {
  const chars = [...(text.value ?? "")];
  const char = end === "first" ? chars.shift()! : chars.pop()!;
  const html: Phrasing = {
    type: "html",
    value: `&#x${char.codePointAt(0)!.toString(16).toUpperCase()};`,
  };
  const rest: Phrasing[] = chars.length
    ? [{ ...text, value: chars.join("") }]
    : [];
  return end === "first" ? [html, ...rest] : [...rest, html];
}

/**
 * Bold or italic whose text starts or ends with punctuation, right against
 * a word: `**per file.**Pasted` doesn't close (a closing `**` after
 * punctuation needs a space or punctuation after it), so the bold read
 * back as text with asterisks in it - text typed or pasted straight after
 * a bold sentence. The word's letter beside it is written as a character
 * reference, `**per file.**&#x50;asted`, which reads as the letter, as
 * remark itself does; CJK text is left alone. The same for strikethrough
 * and highlight: `~~`code`~~` lost its line once a word was typed against
 * it.
 */
function encodeAroundAttention(node: Phrasing): void {
  if (!node.children) return;
  node.children.forEach(encodeAroundAttention);
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const span = children[i];
    if (!FLANKED.has(span.type)) continue;
    const before = children[i - 1];
    const after = children[i + 1];
    if (
      after?.type === "text" &&
      PUNCTUATION.test(innerEdgeCharacter(span, "last")) &&
      WORD.test(edgeCharacter(after, "first"))
    )
      children.splice(i + 1, 1, ...referenced(after, "first"));
    if (
      before?.type === "text" &&
      PUNCTUATION.test(innerEdgeCharacter(span, "first")) &&
      WORD.test(edgeCharacter(before, "last"))
    ) {
      const parts = referenced(before, "last");
      children.splice(i - 1, 1, ...parts);
      i += parts.length - 1;
    }
  }
}

/**
 * Bold directly inside bold, or italic inside italic, at its end and with
 * text right after it: `*foo *bar**Pasted`. The two closing runs are one,
 * `**`, which can open as well as close there, and the rule of 3 then
 * keeps it from closing a single `*`: both spans read back as text with
 * asterisks in it - text pasted or typed after a nested span. The inner
 * span is written with underscores, `*foo _bar_*`, so the runs stay
 * apart, and encodeAroundAttention writes the word's letter after it as a
 * character reference. The same at the start, with text right before.
 * Not where the underscores would stand against a word inside the span:
 * they don't open or close in a word.
 */
function alternateNestedMarkers(node: Phrasing): void {
  if (!node.children) return;
  node.children.forEach(alternateNestedMarkers);
  const children = node.children;
  const outside = (child: Phrasing | undefined, end: "first" | "last") =>
    child !== undefined && /^\S$/u.test(edgeCharacter(child, end));
  const free = (child: Phrasing | undefined, end: "first" | "last") =>
    child === undefined || !/^[\p{L}\p{N}]$/u.test(edgeCharacter(child, end));
  children.forEach((span, i) => {
    const inner = span.children ?? [];
    if (!ATTENTION.has(span.type) || !inner.length) return;
    const last = inner[inner.length - 1];
    if (
      last.type === span.type &&
      outside(children[i + 1], "first") &&
      free(inner[inner.length - 2], "last")
    )
      last.marker = "_";
    const first = inner[0];
    if (
      first.type === span.type &&
      outside(children[i - 1], "last") &&
      free(inner[1], "first")
    )
      first.marker = "_";
  });
}

/** Set up per serialization, before any node is written. */
const root: Handle = (node, parent, state, info) => {
  joinAdjacent(node as Phrasing);
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

/**
 * A callout's marker - `> [!NOTE]` and its kin, opening a quote - is
 * written as it was typed. remark escapes the bracket ("\\[!NOTE]") in case
 * it starts a reference link, which Textus still reads as an alert
 * (github-alert-plugin.ts) but GitHub and every other tool no longer do.
 * Any type word in any case counts, with Obsidian's fold sign after it
 * (`[!tip]-`): Obsidian has callout types of its own (`[!question]`), which
 * Textus shows as a plain quote but must not break for the tools that
 * read them.
 */
const ALERT_MARKER = /^\\(\[![A-Za-z]+\])/;

function keepAlertMarker(text: Handle): Handle {
  return (node, parent, state, info) => {
    const out = text(node, parent, state, info);
    const opensQuote =
      parent?.type === "paragraph" &&
      parent.children[0] === node &&
      state.stack.includes("blockquote");
    return opensQuote ? out.replace(ALERT_MARKER, "$1") : out;
  };
}

/**
 * Text ending in a space is escaped like any other. Milkdown's text
 * handler returns such text as it is, to keep the space from being written
 * `&#x20;`, and so wrote `# bar ` at the start of a line unescaped - a
 * heading on reopening - once the word after it was deleted or made bold;
 * a `- ` or `1. ` likewise became a list. The space is still kept as it is.
 */
function escapingBeforeSpaces(text: Handle): Handle {
  return (node, parent, state, info) => {
    const value = node.value;
    const body = value.replace(/\s+$/, "");
    if (body === value || /[*_\\]/.test(value))
      return text(node, parent, state, info);
    const spaces = value.slice(body.length);
    if (body)
      return state.safe(body, { ...info, after: spaces, encode: [] }) + spaces;
    // Spaces alone, at the start of a line with more after them, are
    // encoded: a tab there opens indented code. A line of spaces only
    // stays as it is.
    const lineStart = !info.before || /[\r\n]$/.test(info.before);
    const more = info.after !== undefined && !/^[\r\n]?$/.test(info.after);
    return lineStart && more && !/[\r\n]/.test(spaces)
      ? state.safe(spaces, { ...info, encode: [] })
      : spaces;
  };
}

/** Per serialization: the escaped openers, `\\[` and `\\(`, written so far. */
const openEscapes = new WeakMap<State, Set<string>>();
const OPENERS: Record<string, string> = { "]": "[", ")": "(" };
const REFERENCES: Record<string, string> = { "]": "&#93;", ")": "&#41;" };

/** Text nodes with a formula written `\\[...\\]` or `\\(...\\)` after them
 *  in their paragraph, heading or cell, by its opening bracket. */
const latexAhead = new WeakMap<Phrasing, Set<string>>();
const PHRASING_BLOCKS = new Set(["paragraph", "heading", "tableCell"]);

function markLatexAhead(node: Phrasing): void {
  if (!PHRASING_BLOCKS.has(node.type)) {
    node.children?.forEach(markLatexAhead);
    return;
  }
  const leaves: Phrasing[] = [];
  const walk = (child: Phrasing) => {
    if (child.children) child.children.forEach(walk);
    else leaves.push(child);
  };
  walk(node);
  const ahead = new Set<string>();
  for (const leaf of leaves.reverse()) {
    const delimiter =
      leaf.type === "inlineMath"
        ? (leaf.data as MathData)?.mathDelimiter
        : undefined;
    if (delimiter?.startsWith("\\")) ahead.add(delimiter.charAt(1));
    else if (leaf.type === "text" && ahead.size)
      latexAhead.set(leaf, new Set(ahead));
  }
}

/**
 * Brackets escaped as text never pair into LaTeX math. Textus reads
 * `\\[...\\]` and `\\(...\\)` as maths (latex-math-syntax.ts), and remark
 * escapes both brackets of a link text's `[b]` - so editing
 * `[Tech [Episodes]](u)` saved `[Tech \\[Episodes\\]](u)`, which read back
 * as a formula. Every escaped closer after an escaped opener is written as
 * a character reference instead, which reads as the bracket everywhere.
 * So is an escaped opener with a formula in LaTeX's brackets after it in
 * its block: before `\\[x\\]`, a `\\[` the text was written with opened a
 * formula that ran to that one's end (`[['\\[', '\\]']` in a config
 * snippet, once edited).
 */
function withoutLatexPairs(text: Handle): Handle {
  return (node, parent, state, info) => {
    const out = text(node, parent, state, info);
    if (!out.includes("\\")) return out;
    let open = openEscapes.get(state);
    if (!open) openEscapes.set(state, (open = new Set()));
    const opened = open;
    return out.replace(/\\([\s\S])/g, (escape, char: string) => {
      if (char === "[" || char === "(") {
        if (latexAhead.get(node as Phrasing)?.has(char))
          return char === "[" ? "&#91;" : "&#40;";
        opened.add(char);
      } else if (OPENERS[char] && opened.has(OPENERS[char]))
        return REFERENCES[char];
      return escape;
    });
  };
}

/**
 * Line ends in a paragraph's text, Milkdown's soft breaks, as Markdown can
 * hold them: one at a time, and not at the paragraph's ends. Each is shown
 * as a space; deleting the one word on a line left two in a row, which were
 * written as a blank line and split the paragraph in two, and one at the
 * end of a paragraph (its last line's words deleted) was a stray line.
 */
function withSingleLineEnds(text: Handle): Handle {
  return (node, parent, state, info) => {
    const siblings = (parent?.children ?? []) as Phrasing[];
    const index = siblings.indexOf(node);
    // Each soft break is a text node of its own.
    const previous = siblings[index - 1];
    let value = node.value.replace(/\n[ \t]*(?:\n[ \t]*)+/g, "\n");
    if (
      index === 0 ||
      (previous?.type === "text" && /\n[ \t]*$/.test(previous.value ?? ""))
    )
      value = value.replace(/^\n+/, "");
    if (index === siblings.length - 1) value = value.replace(/\n+$/, "");
    // In place: the handlers inside find the node among its siblings.
    node.value = value;
    return text(node, parent, state, info);
  };
}

/**
 * A hard line break as Markdown can hold it. At the end of a paragraph it
 * is nothing: `\\` there is a literal backslash, so a Shift+Enter left at
 * the end of a line came back as one. Before a line end that is already in
 * the text (a `<br>` at the end of a line, br-hardbreak-plugin.ts) it is
 * the backslash alone: its own line end and that one made a blank line,
 * which split the paragraph.
 */
const hardBreak: Handle = (node, parent, state, info) => {
  const siblings = (parent?.children ?? []) as {
    type: string;
    value?: string;
  }[];
  const rest = siblings.slice(siblings.indexOf(node as never) + 1);
  if (
    rest.every(
      (next) =>
        next.type === "break" ||
        (next.type === "text" && !/[^\s]/.test(next.value ?? "")),
    )
  )
    return "";
  const out = defaultHandlers.break(node, parent, state, info);
  return rest[0]?.type === "text" && rest[0].value?.startsWith("\n")
    ? out.replace(/\n$/, "")
    : out;
};

/** Installs the rules above. `update`, not `set`: the slice already carries
 *  Milkdown's own text/strong/emphasis handlers, and replacing it wholesale
 *  would drop them. */
export function configureMarkdownOutput(ctx: Ctx): void {
  keepLinkAcrossInlineNodes(ctx);
  configureImageNode(ctx);
  keepCodeFenceMeta(ctx);
  // The editor's opening text (MilkdownEditor sets it before this runs).
  const initial = ctx.get(defaultValueCtx);
  const bullet = typeof initial === "string" ? documentBullet(initial) : null;
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
      break: hardBreak,
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
