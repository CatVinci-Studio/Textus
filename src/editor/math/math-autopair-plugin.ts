import { Plugin, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { fenceLineToBlock } from "../markdown/fence-line";
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

/** See the Enter handler: the paragraph shapes that mean "the user typed $$". */
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
 * was typed as: "$", its source, then `suffix` (the closing "$" and/or
 * what is being typed). The caret lands after it all, or `caretOffset`
 * characters into the source.
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
 * Typing prose with dollar amounts in it. A fresh "$" opens a formula
 * (below), so without this "It costs $5 a month." became the formula
 * "5 a month." - and stayed one into the next paragraph - while the file
 * read back as text. Pandoc's rule decides, as it does when the file is
 * opened (math-schema.ts):
 * - a space typed right after "$" and a number ("$5 ") ends a price, not
 *   a formula: the "$" goes back to text. A formula really starting with a
 *   number still forms when its closing "$" is typed (findRunOpen);
 * - a digit typed right after a formula ("$...$1") means its closing "$"
 *   was a price too, so the pair goes back to text.
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
 * What typing "$" does, modeled on how code editors auto-close brackets -
 * built on real math_inline nodes so the shared enclosure model
 * (enclosure.ts: delimiter reveal, cursor phases, delimiter deletion) and
 * math-preview-plugin (KaTeX render, floating live preview) drive the whole
 * experience uniformly for inline and block math alike:
 *
 * - Typing "$" outside any math opens an *empty* math_inline node right away,
 *   cursor inside - unless unclosed literal "$..."-looking text directly
 *   before the caret can be converted into a real formula instead (the
 *   findRunOpen path, which is also how a deleted "$" comes back when
 *   retyped).
 * - Typing "$" again while inside, exactly at the end of the node's content,
 *   closes it: non-empty content stays a real math_inline node and the
 *   cursor steps past it; empty content reverts to literal "$$" text instead
 *   of leaving a near-invisible empty formula node behind.
 * - Typing "$" anywhere else inside math source is just literal text.
 * - Enter right after opening an empty pair - with nothing else on the line
 *   - promotes the shell to an empty math_block.
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

            // "$4) and $": Pandoc's rule (math-schema.ts) - a formula
            // can't start or end with a space. The pair stays the literal
            // text the file will read back as.
            if (
              parent.type.name === "math_inline" &&
              /^\s|\s$/.test(parent.textContent)
            ) {
              view.dispatch(unwrapInlineMath(state, nodeStart, "$"));
              return true;
            }

            if (parent.content.size === 0) {
              // Empty pair, closed immediately - revert to literal "$$" rather
              // than leave an empty formula node rendering as a stray widget.
              const tr = state.tr.replaceWith(
                nodeStart,
                nodeEnd,
                state.schema.text("$$"),
              );
              view.dispatch(caretAt(tr, nodeStart + 2));
              return true;
            }

            // Non-empty - leave it as a real node, step past it.
            view.dispatch(caretAt(state.tr, nodeEnd));
            return true;
          }

          // WKWebView can normalize the caret from inside an empty shell to
          // just after it, so the closing "$" arrives attributed to the
          // paragraph instead of the shell - same close-empty-pair
          // semantics as the inMath branch above.
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

          // Complete a "$" typed in FRONT of existing content whose closing
          // "$" already sits ahead in the literal text - the forward mirror
          // of the findRunOpen path above.
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

          // With content still following the caret the "$" is being typed
          // into the middle of existing text - keep it literal instead of
          // spawning a fresh empty shell (converting an open run above
          // still works mid-line).
          if ($pos.parentOffset !== parent.content.size) return false;

          // Fresh "$" - open an empty math_inline node, cursor inside.
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

          // A line whose whole content amounts to a typed "$$" also promotes
          // to a block. That state comes in several shapes: literal "$$"
          // text (the second "$" closed the empty pair and reverted it - see
          // handleTextInput above), a single empty shell the caret got
          // normalized out of (WKWebView), or two empty shells left by the
          // pre-fix version of that normalization bug.
          if (
            parent.type.name === "paragraph" &&
            $from.parentOffset === parent.content.size &&
            isMathFenceLine(parent)
          ) {
            view.dispatch(
              fenceLineToBlock(
                state,
                $from.before(),
                state.schema.nodes.math_block,
              ),
            );
            event.preventDefault();
            return true;
          }

          if (parent.type.name !== "math_inline") return false;
          if (parent.content.size !== 0) {
            // Enter inside a formula that was never closed ("costs $5."):
            // a "$" with no partner is just a dollar sign, so it goes back
            // to text and Enter then splits the line as usual - instead of
            // carrying the open formula, and everything typed after it,
            // into the next paragraph.
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
          // The line must contain nothing but the typed "$$" (in any of its
          // shapes - see isMathFenceLine) so a stray empty pair elsewhere on
          // a longer line can't hijack Enter.
          if (!isMathFenceLine(paragraph)) return false;

          view.dispatch(
            fenceLineToBlock(
              state,
              $from.before(paragraphDepth),
              state.schema.nodes.math_block,
            ),
          );
          event.preventDefault();
          return true;
        },
      },
    }),
);
