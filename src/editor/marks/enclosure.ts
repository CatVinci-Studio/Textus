import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  cursorTouches,
  enclosureDelims,
  isEnclosure,
  isEnclosureName,
} from "./enclosure-runs";
import {
  computeArrowLeft,
  computeArrowRight,
  computeBackspace,
  computeCharDeleteBesideEnclosure,
  computeDelete,
  computeRangeDeleteInEnclosure,
  emptyEnclosureContent,
  isSoleEnclosureChild,
  pastNestedEdge,
} from "./enclosure-moves";
import {
  COMPOSE_RELOCATE_DELAY_MS,
  type CompositionAnchor,
  applyDeleteAction,
  pinDomCaretForComposition,
  relocateComposedText,
  snapshotAdjacentEnclosures,
} from "./enclosure-caret";
import { caretAt, setCaret, stateWithLiveSelection } from "../live-selection";
import { isImeKeyEvent } from "../keys/ime";
export {
  isEnclosureName,
  cursorTouches,
  literalTextBefore,
  literalTextAfter,
  findRunOpen,
  findRunClose,
  hasPendingRunOpen,
} from "./enclosure-runs";
export {
  type ArrowMove,
  type DeleteAction,
  computeCharDeleteBesideEnclosure,
} from "./enclosure-moves";
export { COMPOSE_RELOCATE_DELAY_MS } from "./enclosure-caret";
/**
 * Shared model for delimiter-enclosed syntax (md_span, md_code_span, math):
 * real nodes with editable text, their delimiters synthesized as widgets.
 * Left/Right move one phase per press (away | adjacent `|*hello*` | inside
 * `*|hello*`), so a delimiter acts as one pseudo-character. Every boundary
 * crossing is handled here, since WKWebView normalizes native caret moves
 * to the wrong side of the node.
 */

const enclosureKey = new PluginKey("enclosure");

/** Inline nodes kept as source text: no delimiters, but text typed right
 *  after one lands in it the same way ("[[Note]] and" linked "Note]] and"). */
const SOURCE_INLINE_NODES = new Set(["wikilink", "obsidian_embed", "html"]);

/**
 * WKWebView normalizes a caret just outside an inline element to just
 * inside it, so text typed after leaving an enclosure arrives inside its
 * content. When the input is inside but the selection isn't, the input is
 * re-routed through the handlers at the real caret. Autopair plugins call
 * this first.
 */
export function redirectMisattributedInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  // During IME composition the preedit is ahead of the state, so positions
  // disagree for other reasons, and dispatching would abort the composition.
  if (view.composing) return false;
  if (from !== to) return false;
  const { state } = view;
  const sel = state.selection;
  if (!sel.empty) return false;
  const $typed = state.doc.resolve(from);
  const name = $typed.parent.type.name;
  if (!isEnclosureName(name) && !SOURCE_INLINE_NODES.has(name)) return false;
  const nodeStart = $typed.before($typed.depth);
  const nodeEnd = $typed.after($typed.depth);
  if (sel.from > nodeStart && sel.from < nodeEnd) return false;
  const deflt = () => state.tr.insertText(text, sel.from, sel.to);
  const handled = view.someProp("handleTextInput", (f) =>
    f(view, sel.from, sel.to, text, deflt),
  );
  if (!handled) view.dispatch(deflt());
  return true;
}

function makeDelimiterEl(delimiter: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "enclosure-delimiter";
  span.textContent = delimiter;
  span.contentEditable = "false";
  return span;
}

function buildDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];

  // Only enclosures the cursor touches are decorated, so only the selection
  // (widened for adjacency) is walked, on every keystroke.
  const { selection, doc } = state;
  // Two for a span nested whole, touched through its outer one.
  const scanFrom = Math.max(0, selection.from - 2);
  const scanTo = Math.min(doc.content.size, selection.to + 2);
  doc.nodesBetween(scanFrom, scanTo, (node, pos, parent) => {
    if (!isEnclosure(node)) return;
    const from = pos;
    const to = pos + node.nodeSize;
    // A span that is all of another's (bold-italic) shows its delimiters with
    // the outer one's: one `***` pair.
    const whole = !!parent && isSoleEnclosureChild(parent);
    if (
      !cursorTouches(state.selection, from, to) &&
      !(whole && cursorTouches(state.selection, from - 1, to + 1))
    )
      return;

    // Real widgets, not ::before/::after: WKWebView draws the caret on the wrong
    // side of generated content. Inline widgets sit in the paragraph, outside
    // the node, so prosemirror-view's separator workaround for uneditable last
    // children engages and WebKit paints the caret where it is. math_block gets
    // a node decoration instead, keeping a line box for the caret.
    const { open, close } = enclosureDelims(node);
    if (node.isBlock) {
      decorations.push(
        Decoration.node(from, to, { class: "math-block-revealed" }),
      );
    } else {
      // side 1 on the opener and -1 on the closer keep the caret at the outer
      // boundary outside the delimiters, and text typed there outside too.
      decorations.push(
        Decoration.widget(from, () => makeDelimiterEl(open), {
          side: 1,
          key: `enc-open:${open}`,
        }),
      );
      decorations.push(
        Decoration.widget(to, () => makeDelimiterEl(close), {
          side: -1,
          key: `enc-close:${close}`,
        }),
      );
    }
  });

  return DecorationSet.create(state.doc, decorations);
}

const wordSegmenter: Intl.Segmenter | undefined =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : undefined;

/**
 * The word at `pos` inside a bold or italic span, cut as a double click
 * would (Intl.Segmenter, so Chinese too); null outside a span of plain text
 * or on a space.
 */
export function wordInEnclosureAt(
  doc: ProseNode,
  pos: number,
): { from: number; to: number } | null {
  if (!wordSegmenter || pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  if (!isEnclosure(parent) || parent.isBlock) return null;
  // Between one span's edge and another's inside it, the word is in the
  // inner one.
  const inner = [$pos.nodeAfter, $pos.nodeBefore].findIndex(
    (n) => !!n && isEnclosure(n) && !n.isBlock,
  );
  if (inner === 0) return wordInEnclosureAt(doc, pos + 1);
  if (inner === 1) return wordInEnclosureAt(doc, pos - 1);
  let text = "";
  let plain = true;
  parent.forEach((child) => {
    if (child.isText) text += child.text;
    else plain = false;
  });
  if (!plain || !text) return null;
  const offset = $pos.parentOffset;
  for (const seg of wordSegmenter.segment(text)) {
    const end = seg.index + seg.segment.length;
    if (offset < seg.index || offset > end) continue;
    if (!seg.isWordLike) continue;
    const start = $pos.start();
    return { from: start + seg.index, to: start + end };
  }
  return null;
}

/** How close in time and place a double click's second press is. */
const DOUBLE_CLICK_MS = 600;
const DOUBLE_CLICK_PX = 6;

export const enclosurePlugin = $prose(() => {
  let compositionAnchors: CompositionAnchor[] = [];
  // Where the first press of a possible double click landed, read before it
  // revealed a span's delimiters.
  let firstPress: { pos: number; x: number; y: number; at: number } | null =
    null;
  return new Plugin<DecorationSet>({
    key: enclosureKey,
    state: {
      init: (_config, state) => buildDecorations(state),
      apply(tr, prev, _oldState, newState) {
        if (!tr.docChanged && !tr.selectionSet) return prev;
        return buildDecorations(newState);
      },
    },
    view(editorView) {
      // Dev-only handle for poking at caret bugs from a console.
      if (import.meta.env.DEV)
        (window as Window & { __pmView?: EditorView }).__pmView = editorView;
      return {};
    },
    props: {
      decorations(state) {
        return enclosureKey.getState(state);
      },
      handleDOMEvents: {
        // A double click on a bold or italic word selects that word. The first
        // press reveals the span's `**` and moves the text, so WebKit took the
        // second press for the wrong place; the word under the first press is used.
        mousedown(view, event) {
          if (
            event.button !== 0 ||
            event.shiftKey ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey
          ) {
            firstPress = null;
            return false;
          }
          if (event.detail === 1) {
            const hit = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            firstPress = hit
              ? {
                  pos: hit.pos,
                  x: event.clientX,
                  y: event.clientY,
                  at: event.timeStamp,
                }
              : null;
            return false;
          }
          const first = firstPress;
          firstPress = null;
          if (
            event.detail !== 2 ||
            !first ||
            event.timeStamp - first.at > DOUBLE_CLICK_MS ||
            Math.abs(event.clientX - first.x) > DOUBLE_CLICK_PX ||
            Math.abs(event.clientY - first.y) > DOUBLE_CLICK_PX
          )
            return false;
          const word = wordInEnclosureAt(view.state.doc, first.pos);
          if (!word) return false;
          event.preventDefault();
          view.focus();
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, word.from, word.to),
            ),
          );
          return true;
        },
        compositionstart(view) {
          compositionAnchors = snapshotAdjacentEnclosures(view.state);
          if (compositionAnchors.length > 0)
            pinDomCaretForComposition(view, compositionAnchors);
          return false;
        },
        compositionend(view) {
          const anchors = compositionAnchors;
          compositionAnchors = [];
          if (anchors.length === 0) return false;
          // prosemirror-view flushes the composition a little after this event;
          // relocate once the committed text is in the state.
          setTimeout(
            () => relocateComposedText(view, anchors),
            COMPOSE_RELOCATE_DELAY_MS,
          );
          return false;
        },
      },
      handleKeyDown(view, event) {
        if (isImeKeyEvent(view, event)) return false;
        // Modified keys are line/word-level commands, never single phase steps.
        if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey)
          return false;
        const state = stateWithLiveSelection(view);

        if (event.key === "ArrowRight") {
          const move = computeArrowRight(state);
          if (!move) return false;
          event.preventDefault();
          setCaret(view, pastNestedEdge(state, move, 1).pos);
          return true;
        }

        if (event.key === "ArrowLeft") {
          const move = computeArrowLeft(state);
          if (!move) return false;
          event.preventDefault();
          setCaret(view, pastNestedEdge(state, move, -1).pos);
          return true;
        }

        if (event.key === "Backspace" || event.key === "Delete") {
          const rangeAction = computeRangeDeleteInEnclosure(state);
          if (rangeAction) {
            event.preventDefault();
            emptyEnclosureContent(
              view,
              rangeAction.node,
              rangeAction.nodeStart,
            );
            return true;
          }
        }

        if (event.key === "Backspace" || event.key === "Delete") {
          const forward = event.key === "Delete";
          const action = forward
            ? computeDelete(state)
            : computeBackspace(state);
          if (action) {
            event.preventDefault();
            applyDeleteAction(view, action);
            return true;
          }
          const range = computeCharDeleteBesideEnclosure(
            state,
            forward ? "forward" : "backward",
          );
          if (!range) return false;
          event.preventDefault();
          view.dispatch(
            caretAt(view.state.tr.delete(range.from, range.to), range.from),
          );
          return true;
        }

        return false;
      },
    },
  });
});
