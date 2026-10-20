import { InputRule } from "@milkdown/kit/prose/inputrules";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { $inputRule } from "@milkdown/kit/utils";

/**
 * `[text](url)` typed out becomes a link as its `)` goes in, the way `**`
 * and `` ` `` become their marks; without it, a link typed in the editor
 * stayed as brackets and parentheses. The text is plain: a run with an
 * inline node in it (code, math - the object replacement character in the
 * rule's view of the text) is left alone rather than flattened. An image's
 * `![` is left alone too: TYPED_IMAGE below takes it.
 */
export const TYPED_LINK = /(?<!!)\[([^[\]\n\ufffc]+)\]\(([^()\s\ufffc]+)\)$/;

/**
 * `![alt](src)` typed out becomes an image the same way (issue #189).
 * Milkdown's commonmark preset defines an image input rule but leaves it
 * out of the preset, so a typed image stayed text, and saving escaped it
 * to `!\[alt]\(src)` - which no Markdown reader shows as an image. The alt
 * may be empty, as `![](src)` is how a picture without one is written;
 * `![[file]]` is an Obsidian embed (obsidian-embed.ts), not this.
 */
export const TYPED_IMAGE = /!\[([^[\]\n\ufffc]*)\]\(([^()\s\ufffc]+)\)$/;

type Match = RegExpMatchArray | RegExpExecArray;

/** `[text](url)` at start..end as a link: the input rule's change, and the
 *  bracket autopair's when the caret leaves a ")" it put in. */
function typedLink(
  state: EditorState,
  match: Match,
  start: number,
  end: number,
): Transaction | null {
  const link = state.schema.marks.link;
  const [, text, href] = match;
  const $start = state.doc.resolve(start);
  if (
    !link ||
    !text.trim() ||
    $start.parent.type.spec.code ||
    !$start.parent.type.allowsMarkType(link)
  )
    return null;
  return (
    state.tr
      .replaceWith(start, end, state.schema.text(text, [link.create({ href })]))
      // Typing on after the link should not extend it.
      .setStoredMarks([])
  );
}

/** `![alt](src)` at start..end as an image, the same two ways. */
function typedImage(
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
  // A URL pasted between the parentheses is a link (paste-url.ts); the
  // replacement drops it with the rest of the typed text.
  return state.tr
    .replaceWith(start, end, image.create({ src, alt }))
    .setStoredMarks([]);
}

/**
 * A typed link or image whose ")" is the last character before `end`, as
 * the input rules would have made it had the ")" been typed - for the
 * bracket autopair (keys/bracket-autopair-plugin.ts), whose ")" is already
 * there when the caret moves on past it, or Enter is pressed before it.
 * Only the text node ending there is read. Null when there is none.
 */
export function typedLinkEndingAt(
  state: EditorState,
  end: number,
): Transaction | null {
  const before = state.doc.resolve(end).nodeBefore;
  if (!before?.isText) return null;
  const text = before.text!;
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
