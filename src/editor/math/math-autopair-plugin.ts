import { Plugin, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  caretAt,
  findRunClose,
  findRunOpen,
  isImeKeyEvent,
  literalTextAfter,
  literalTextBefore,
  redirectMisattributedInput,
  stateWithLiveSelection,
} from "../marks/enclosure";

const DOLLAR = "$";

/** The paragraph shapes that mean "the user typed $$". */
function isMathFenceLine(paragraph: ProseNode): boolean {
  if (paragraph.childCount === 1 && paragraph.child(0).isText)
    return paragraph.child(0).text === "$$";
  if (paragraph.childCount < 1 || paragraph.childCount > 2) return false;
  for (let i = 0; i < paragraph.childCount; i++) {
    const child = paragraph.child(i);
    if (child.type.name !== "math_inline" || child.content.size !== 0)
      return false;
  }
  return true;
}

/**
 * Turns the math_inline node at `nodeStart` back into the literal text it
 * was typed as, then `suffix`. The caret lands after it all, or
 * `caretOffset` characters into the source.
 */
function unwrapInlineMath(
  state: EditorState,
  nodeStart: number,
  suffix: string,
  caretOffset?: number,
) {
  const node = state.doc.nodeAt(nodeStart)!;
  const literal = DOLLAR + node.textContent + suffix;
  const tr = state.tr.replaceWith(
    nodeStart,
    nodeStart + node.nodeSize,
    state.schema.text(literal),
  );
  return caretAt(
    tr,
    nodeStart + (caretOffset === undefined ? literal.length : 1 + caretOffset),
  );
}

/** A price: the digits of "$5", "$4.99", "$1,000" before a space. */
const PRICE = /^\d[\d.,]*$/;

/**
 * Typing prose with dollar amounts, by Pandoc's rule as when a file opens:
 * a space right after "$5" ends a price, so the "$" goes back to text; a
 * digit right after a formula ("$...$1") means its closing "$" was a price
 * too. Without this "It costs $5 a month." became a formula.
 */
function priceTyping(view: EditorView, from: number, text: string): boolean {
  const { state } = view;
  const $pos = state.doc.resolve(from);
  const parent = $pos.parent;
  if (
    parent.type.name === "math_inline" &&
    /^\s+$/.test(text) &&
    $pos.parentOffset === parent.content.size &&
    PRICE.test(parent.textContent)
  ) {
    view.dispatch(unwrapInlineMath(state, $pos.before($pos.depth), text));
    return true;
  }
  const before = $pos.nodeBefore;
  if (
    /^\d/.test(text) &&
    parent.isTextblock &&
    !parent.type.spec.code &&
    before?.type.name === "math_inline" &&
    before.content.size > 0
  ) {
    view.dispatch(
      unwrapInlineMath(state, from - before.nodeSize, DOLLAR + text),
    );
    return true;
  }
  return false;
}

/**
 * What typing "$" does, like auto-closed brackets on math_inline nodes:
 * outside math it opens an empty node (or converts a literal "$..." run
 * before the caret); at the end of a node it closes it, an empty one
 * reverting to literal "$$"; elsewhere in math it is literal. Enter on an
 * empty pair alone on its line makes a math_block.
 */
export const mathAutopairPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleTextInput(view, from, to, text) {
          if (view.composing) return false; // dispatching mid-composition aborts the IME preedit
          if (from !== to) return false; // a real selection just gets replaced normally
          if (redirectMisattributedInput(view, from, to, text)) return true;
          if (text !== DOLLAR) return priceTyping(view, from, text);

          const { state } = view;
          const $pos = state.doc.resolve(from);
          const parent = $pos.parent;
          const inMath =
            parent.type.name === "math_inline" ||
            parent.type.name === "math_block";

          if (inMath) {
            if ($pos.parentOffset !== parent.content.size) return false; // literal "$" mid-source

            const nodeStart = $pos.before($pos.depth);
            const nodeEnd = nodeStart + parent.nodeSize;

            // "$4) and $": by Pandoc's rule a formula can't start or end with a space,
            // so the pair stays literal text.
            if (
              parent.type.name === "math_inline" &&
              /^\s|\s$/.test(parent.textContent)
            ) {
              view.dispatch(unwrapInlineMath(state, nodeStart, "$"));
              return true;
            }

            if (parent.content.size === 0) {
              // Empty pair closed at once: literal "$$" rather than an empty formula.
              const tr = state.tr.replaceWith(
                nodeStart,
                nodeEnd,
                state.schema.text("$$"),
              );
              view.dispatch(caretAt(tr, nodeStart + 2));
              return true;
            }

            view.dispatch(caretAt(state.tr, nodeEnd));
            return true;
          }

          // WKWebView can normalize the caret out of an empty shell, so the closing
          // "$" arrives in the paragraph: close the empty pair the same way.
          const before = $pos.nodeBefore;
          if (
            before &&
            before.type.name === "math_inline" &&
            before.content.size === 0
          ) {
            const nodeStart = from - before.nodeSize;
            const tr = state.tr.replaceWith(
              nodeStart,
              from,
              state.schema.text("$$"),
            );
            view.dispatch(caretAt(tr, nodeStart + 2));
            return true;
          }

          if (!parent.isTextblock || parent.type.spec.code) return false;

          const { text: textBefore, from: runStart } = literalTextBefore($pos);
          const open = findRunOpen(textBefore, DOLLAR, 1);
          if (open) {
            const mathInline = state.schema.nodes.math_inline;
            const node = mathInline.create({}, state.schema.text(open.value));
            const absOpen = runStart + open.openIdx;
            const tr = state.tr.replaceWith(absOpen, to, node);
            view.dispatch(caretAt(tr, absOpen + node.nodeSize));
            return true;
          }

          // A "$" typed in front of content whose closing "$" already sits ahead.
          const { text: textAfter } = literalTextAfter($pos);
          const close = findRunClose(textBefore, textAfter, DOLLAR, 1);
          if (close) {
            const value = textAfter.slice(0, close.valueLen);
            const node = state.schema.nodes.math_inline.create(
              {},
              state.schema.text(value),
            );
            const tr = state.tr.replaceWith(
              from,
              to + close.valueLen + 1,
              node,
            );
            view.dispatch(caretAt(tr, from + 1));
            return true;
          }

          // With content after the caret, keep the "$" literal rather than open a
          // fresh shell mid-text.
          if ($pos.parentOffset !== parent.content.size) return false;

          const mathInline = state.schema.nodes.math_inline;
          const tr = state.tr.replaceWith(from, to, mathInline.create());
          view.dispatch(caretAt(tr, from + 1));
          return true;
        },
        handleKeyDown(view, event) {
          if (event.key !== "Enter" || isImeKeyEvent(view, event)) return false;
          const state = stateWithLiveSelection(view);
          const { $from, empty } = state.selection;
          if (!empty) return false;
          const parent = $from.parent;

          // A line amounting to a typed "$$" also promotes to a block: literal "$$",
          // or one or two empty shells the caret was normalized out of.
          if (
            parent.type.name === "paragraph" &&
            $from.parentOffset === parent.content.size &&
            isMathFenceLine(parent)
          ) {
            const paragraphPos = $from.before($from.depth);
            const tr = state.tr
              .delete(paragraphPos + 1, paragraphPos + 1 + parent.content.size)
              .setNodeMarkup(paragraphPos, state.schema.nodes.math_block);
            view.dispatch(caretAt(tr, paragraphPos + 1));
            event.preventDefault();
            return true;
          }

          if (parent.type.name !== "math_inline") return false;
          if (parent.content.size !== 0) {
            // Enter inside a formula never closed ("costs $5."): the "$" is a dollar
            // sign, so it goes back to text and Enter splits the line as usual.
            view.dispatch(
              unwrapInlineMath(
                state,
                $from.before($from.depth),
                "",
                $from.parentOffset,
              ),
            );
            return false;
          }

          const paragraphDepth = $from.depth - 1;
          const paragraph = $from.node(paragraphDepth);
          // Only when the line holds nothing but the typed "$$", so a stray empty pair
          // on a longer line can't hijack Enter.
          if (!isMathFenceLine(paragraph)) return false;

          const paragraphPos = $from.before(paragraphDepth);
          const mathBlock = state.schema.nodes.math_block;
          const tr = state.tr
            .delete(paragraphPos + 1, paragraphPos + 1 + paragraph.content.size)
            .setNodeMarkup(paragraphPos, mathBlock);
          view.dispatch(caretAt(tr, paragraphPos + 1));
          event.preventDefault();
          return true;
        },
      },
    }),
);
