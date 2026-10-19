import { InputRule } from "@milkdown/kit/prose/inputrules";
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

export const linkInputRule = $inputRule(
  () =>
    new InputRule(TYPED_LINK, (state, match, start, end) => {
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
          .replaceWith(
            start,
            end,
            state.schema.text(text, [link.create({ href })]),
          )
          // Typing on after the link should not extend it.
          .setStoredMarks([])
      );
    }),
);

export const imageInputRule = $inputRule(
  () =>
    new InputRule(TYPED_IMAGE, (state, match, start, end) => {
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
    }),
);
