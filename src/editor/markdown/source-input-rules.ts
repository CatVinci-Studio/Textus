import { InputRule } from "@milkdown/kit/prose/inputrules";
import { $inputRule } from "@milkdown/kit/utils";

/**
 * Markup typed out becomes the node Textus reads it as from a file, or
 * saving would escape it (`<br>` as `\<br>`, `[^1]` as `\[^1]`).
 */

/** An HTML tag just closed. The object replacement character is another
 *  inline node in the rule's view of the text. */
export const TYPED_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>\n￼]*)?\/?>$/;

/** A footnote reference just closed: `[^1]`, `[^note]`. Not a link's
 *  `[^x](url)`, which the link rule takes once its `)` goes in. */
export const TYPED_FOOTNOTE = /\[\^([^\]\s^￼]+)\]$/;

/** The tag as raw HTML, kept as written and drawn while the caret is away. */
export const htmlTagInputRule = $inputRule(
  () =>
    new InputRule(TYPED_TAG, (state, match, start, end) => {
      const html = state.schema.nodes.html;
      const $start = state.doc.resolve(start);
      if (!html || $start.parent.type.spec.code) return null;
      return state.tr.replaceWith(
        start,
        end,
        html.create(null, state.schema.text(match[0])),
      );
    }),
);

/** The reference as a footnote reference, written back as `[^label]`. */
export const footnoteInputRule = $inputRule(
  () =>
    new InputRule(TYPED_FOOTNOTE, (state, match, start, end) => {
      const reference = state.schema.nodes.footnote_reference;
      const $start = state.doc.resolve(start);
      if (!reference || $start.parent.type.spec.code) return null;
      return state.tr.replaceWith(
        start,
        end,
        reference.create({ label: match[1] }),
      );
    }),
);
