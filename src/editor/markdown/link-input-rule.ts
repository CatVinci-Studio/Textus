import { InputRule } from "@milkdown/kit/prose/inputrules";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { $inputRule } from "@milkdown/kit/utils";
import { LINK } from "./link-source";
import { linkHref, parseLink } from "./link-syntax";

/**
 * `[text](url)` typed out becomes a link as its `)` goes in. A run holding an
 * inline node (code, math) is left alone, and so is an image's `![`.
 */
export const TYPED_LINK = /(?<!!)\[([^[\]\n\ufffc]+)\]\(([^()\s\ufffc]+)\)$/;

/**
 * `![alt](src)` typed out becomes an image the same way: Milkdown leaves its
 * image input rule out of the preset, and saving escaped a typed image to
 * text. `![[file]]` is an Obsidian embed, not this.
 */
export const TYPED_IMAGE = /!\[([^[\]\n\ufffc]*)\]\(([^()\s\ufffc]+)\)$/;

type Match = RegExpMatchArray | RegExpExecArray;

/** Whether start..end is plain text in one block. A rule's match counts the
 *  text inside an inline node (raw HTML, a bold span) but not its two edges,
 *  so a match running over one would start that many positions off. */
export function plainTextRun(
  state: EditorState,
  start: number,
  end: number,
): boolean {
  if (!state.doc.resolve(start).sameParent(state.doc.resolve(end)))
    return false;
  let plain = true;
  state.doc.nodesBetween(start, end, (node) => {
    if (node.isInline && !node.isText) plain = false;
    return plain;
  });
  return plain;
}

/** `[text](url)` at start..end as a link: the input rule's change, and the
 *  autopair's and link-settle's when the caret leaves a ")". */
export function typedLink(
  state: EditorState,
  match: Match,
  start: number,
  end: number,
): Transaction | null {
  return match[1].trim() ? linkNodeAt(state, match[0], start, end) : null;
}

/** `source` at start..end as a link node, or null: none may go there, or Markdown
 *  wouldn't read it as one link (link-normalize would undo it, forever). */
export function linkNodeAt(
  state: EditorState,
  source: string,
  start: number,
  end: number,
): Transaction | null {
  const link = state.schema.nodes[LINK];
  const $start = state.doc.resolve(start);
  if (
    !link ||
    !parseLink(source) ||
    !plainTextRun(state, start, end) ||
    $start.parent.type.spec.code ||
    !$start.parent.canReplaceWith(
      $start.index(),
      state.doc.resolve(end).index(),
      link,
    )
  )
    return null;
  return state.tr.replaceWith(
    start,
    end,
    link.create(null, state.schema.text(source)),
  );
}

/** `![alt](src)` at start..end as an image, the same ways. */
export function typedImage(
  state: EditorState,
  match: Match,
  start: number,
  end: number,
): Transaction | null {
  const image = state.schema.nodes.image;
  const [, alt, written] = match;
  const src = linkHref(match[0].slice(1)) ?? written;
  const $start = state.doc.resolve(start);
  if (
    !image ||
    !plainTextRun(state, start, end) ||
    $start.parent.type.spec.code ||
    !$start.parent.canReplaceWith(
      $start.index(),
      state.doc.resolve(end).index(),
      image,
    )
  )
    return null;
  return state.tr
    .replaceWith(start, end, image.create({ src, alt }))
    .setStoredMarks([]);
}

/**
 * A typed link or image whose ")" is the last character before `end`, for
 * the bracket autopair's ")" that is already there, read across the text
 * nodes a paste or marks split it into. Null when there is none.
 */
export function typedLinkEndingAt(
  state: EditorState,
  end: number,
): Transaction | null {
  const $end = state.doc.resolve(end);
  if (!$end.parent.isTextblock || !$end.nodeBefore?.isText) return null;
  const text = $end.parent.textBetween(
    0,
    $end.parentOffset,
    undefined,
    "\ufffc",
  );
  for (const [pattern, make] of [
    [TYPED_IMAGE, typedImage],
    [TYPED_LINK, typedLink],
  ] as const) {
    const match = pattern.exec(text);
    if (match) return make(state, match, end - match[0].length, end);
  }
  return null;
}

export const linkInputRule = $inputRule(
  () => new InputRule(TYPED_LINK, typedLink),
);

export const imageInputRule = $inputRule(
  () => new InputRule(TYPED_IMAGE, typedImage),
);
