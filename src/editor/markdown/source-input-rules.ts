import { InputRule } from "@milkdown/kit/prose/inputrules";
import { $inputRule } from "@milkdown/kit/utils";

/**
 * Markup typed out that Textus reads from a file as its own node, made
 * that node as its last character goes in - otherwise it stayed text, and
 * saving escaped it to something no Markdown reader takes for markup:
 * `<b>x</b>` as `\<b>x\</b>`, `<br>` as `\<br>`, `[^1]` as `\[^1]`.
 */

/** An HTML tag just closed: `<b>`, `</b>`, `<br/>`, `<span class="x">`.
 *  The object replacement character is another inline node in the rule's
 *  view of the text. */
export const TYPED_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>\n￼]*)?\/?>$/;

/** A footnote reference just closed: `[^1]`, `[^note]`. Not a link's
 *  `[^x](url)`, which the link rule takes once its `)` goes in. */
export const TYPED_FOOTNOTE = /\[\^([^\]\s^￼]+)\]$/;

/** The tag as raw HTML (raw-html-schema.ts), kept as written and drawn
 *  as HTML while the caret is elsewhere. */
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
