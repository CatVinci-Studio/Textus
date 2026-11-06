import { InputRule } from "@milkdown/kit/prose/inputrules";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { $inputRule } from "@milkdown/kit/utils";
import { LINK } from "./link-source";

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

/** `source` at start..end as a link node; null where none may go. */
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
  const [, alt, src] = match;
  const $start = state.doc.resolve(start);
  if (
    !image ||
    $start.parent.type.spec.code ||
    !$start.parent.canReplaceWith(
      $start.index(),
      state.doc.resolve(end).index(),
      image,
    )
  )
    return null;
  // A URL pasted between the parentheses is a link; the replacement drops it
  // with the rest of the typed text.
  return state.tr
    .replaceWith(start, end, image.create({ src, alt }))
    .setStoredMarks([]);
}

/**
 * A typed link or image whose ")" is the last character before `end`, for
 * the bracket autopair's ")" that is already there. The block's text is read
 * across text nodes, since a URL pasted inside is a link of its own. Null
 * when there is none.
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
