import { InputRule } from "@milkdown/kit/prose/inputrules";
import { $inputRule } from "@milkdown/kit/utils";

/**
 * `[text](url)` typed out becomes a link as its `)` goes in, the way `**`
 * and `` ` `` become their marks; without it, a link typed in the editor
 * stayed as brackets and parentheses. The text is plain: a run with an
 * inline node in it (code, math - the object replacement character in the
 * rule's view of the text) is left alone rather than flattened. An image's
 * `![` is left alone too.
 */
export const TYPED_LINK = /(?<!!)\[([^[\]\n\ufffc]+)\]\(([^()\s\ufffc]+)\)$/;

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
