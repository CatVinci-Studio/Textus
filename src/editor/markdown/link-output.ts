import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { SerializerReady, serializerCtx } from "@milkdown/kit/core";
import { linkSchema } from "@milkdown/kit/preset/commonmark";
import { Fragment } from "@milkdown/kit/prose/model";
import type { Mark, Node as ProseNode } from "@milkdown/kit/prose/model";
import type { MarkdownNode } from "@milkdown/kit/transformer";
import type { Link, Parents } from "mdast";
import {
  defaultHandlers,
  type Handle,
  type State,
  type Unsafe,
} from "mdast-util-to-markdown";
import { referenceFor, type LinkReference } from "./reference-links";
import { phrasingKey, readLinkSource } from "./link-source";
import { isEmptySpan } from "../marks/md-span-schema";
import type { Phrasing } from "./span-output";

/**
 * Links written back as the writer wrote them: the syntax they were typed
 * in (resource, autolink, bare), a link kept whole across bold or code
 * inside it, and one mark per span on the way out (markdown-output.ts).
 */

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

export interface Positioned {
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
export function textOf(node: {
  value?: unknown;
  children?: unknown[];
}): string {
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
export function keepLinkAcrossInlineNodes(ctx: Ctx): void {
  ctx.update(linkSchema.key, (prev) => (innerCtx) => {
    const schema = prev(innerCtx);
    return {
      ...schema,
      // Typing at a link's end goes on after it, not into it: pasted, a
      // link took the words typed after it ("Textus now" all linked). A
      // link's text is edited as its source (link-reveal.ts).
      inclusive: false,
      attrs: {
        ...schema.attrs,
        syntax: { default: "resource", validate: "string" },
        // How a reference link was written (reference-links.ts).
        reference: { default: "", validate: "string" },
        // The Markdown it was written as (link-source.ts).
        source: { default: "", validate: "string" },
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
        delete attrs.source;
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
            source:
              (node.data as { source?: string } | undefined)?.source ?? "",
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
              data: {
                linkSyntax: mark.attrs.syntax,
                source: mark.attrs.source,
              },
            });
        },
      },
    };
  });
}

/** Whether `link` is on `node`, or on everything inside it. */
export function linked(node: ProseNode, link: Mark): boolean {
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
export function firstLink(node: ProseNode): Mark | undefined {
  let found: Mark | undefined;
  node.descendants((child) => {
    found ??= child.marks.find((mark) => mark.type.name === "link");
    return !found && !child.isText;
  });
  return found;
}

export function withoutMark(content: Fragment, link: Mark): Fragment {
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
export function linksOnSpansIn(content: Fragment): Fragment | null {
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

export function linksOnSpans(node: ProseNode): ProseNode {
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
export function withLinkInside(node: ProseNode, link: Mark): ProseNode {
  if (node.isText || node.isLeaf || node.type.spec.marks === "")
    return node.mark(link.addToSet(node.marks));
  const children: ProseNode[] = [];
  node.forEach((child) => children.push(withLinkInside(child, link)));
  return node.copy(Fragment.from(children));
}

/**
 * Runs one of remark's link functions with its `resourceLink` switch ("never
 * <...>") set the way this link's syntax asks. The option is shared by the
 * whole serialization, so it is set only around the one call.
 */
export function asWritten<T>(
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

export type PeekingHandle = Handle & { peek: Handle };
export const defaultLink = defaultHandlers.link as PeekingHandle;

/** A bare `www.x.org`, which GFM links with an `http://` URL. It has no
 *  `<...>` form - remark wrote `[www.x.org](http://www.x.org)` - and,
 *  written bare as it was, it reads back the same (see `root` below).
 *  Not with text right after it, which would read as more of the address
 *  (`www.x.orgPasted`), nor with punctuation and then text
 *  (`www.x.org/a.b.Pasted`: GFM leaves out only punctuation at the end):
 *  then it is written `[www.x.org](http://www.x.org)`. */
export function bareWww(
  node: Link,
  parent: Parents | undefined,
): string | null {
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
export function textAfter(node: Link, parent: Parents | undefined): string {
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
export const endsAddress = (rest: string) =>
  /^[.,:;!?"')]*(?:\s|$)/u.test(rest);

/**
 * The link's own Markdown (link-source.ts), when it can be written as it
 * was: the link still says what that text says, and the text reads back
 * the same here - not across lines, whose indent a list or a quote sets,
 * nor with a `|` in a table cell, which would end the cell. A bare URL is
 * left to `bareWww` and remark's `<...>`, which every Markdown tool reads
 * as a link: a bare one is GFM's alone.
 */
export function linkAsTyped(node: Link, state: State): string | null {
  const typed = readLinkSource(
    (node.data as { source?: unknown } | undefined)?.source,
  );
  if (
    !typed ||
    typed.url !== node.url ||
    typed.title !== (node.title ?? "") ||
    typed.key !== phrasingKey(node.children as never)
  )
    return null;
  const { source } = typed;
  if (!/^[[<]/.test(source) || /[\r\n]/.test(source)) return null;
  if (state.stack.includes("tableCell") && /(?<!\\)\|/.test(source))
    return null;
  return source;
}

/** Writes a link as it was typed, or else in the syntax it was read in
 *  (LinkSyntax above). */
export const link = Object.assign(
  ((node, parent, state, info) => {
    const typed = linkAsTyped(node, state);
    if (typed !== null) return typed;
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
      linkAsTyped(node, state)?.charAt(0) ??
      bareWww(node, parent)?.charAt(0) ??
      asWritten(node, state, () =>
        defaultLink.peek(node, parent, state, info),
      )) as Handle,
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
export const isAutolinkLiteralGuard = (pattern: Unsafe) =>
  (pattern.character === "@" && pattern.before === "[+\\-.\\w]") ||
  (pattern.character === "." && pattern.before === "[Ww]") ||
  (pattern.character === ":" && pattern.before === "[ps]");
