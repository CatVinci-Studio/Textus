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
  caretAt,
  pinDomCaretForComposition,
  relocateComposedText,
  setCaret,
  snapshotAdjacentEnclosures,
  stateWithLiveSelection,
} from "./enclosure-caret";
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
export {
  caretAt,
  liveCaretPos,
  stateWithLiveSelection,
  COMPOSE_RELOCATE_DELAY_MS,
} from "./enclosure-caret";
/**
 * Shared model for every delimiter-enclosed syntax construct - bold/italic/
 * strikethrough/highlight (md_span), inline code (md_code_span), and math
 * (math_inline/math_block). All of them are real ProseMirror nodes whose
 * content is real, always-editable text; the wrapping markdown delimiters
 * ("**", "~~", "==", "`", "$", "$$") are NOT characters in the document -
 * they're derived from the node type/attrs and synthesized as non-editable
 * widget decorations. This module is the single owner of how the cursor and
 * editing keys interact with that synthesized syntax.
 *
 * The cursor has three phases relative to an enclosure, and Left/Right move
 * exactly one phase per press, so the delimiter behaves like a single
 * editable pseudo-character even though it occupies no document position:
 *
 *   away:      ... text | *hello*        delimiters hidden (or, for math,
 *                                        the KaTeX render shown instead)
 *   adjacent:  ... text |*hello*         cursor at the node's outer boundary;
 *              ... text *hello*|         delimiters revealed, cursor visually
 *                                        outside them
 *   inside:    ... text *|hello*         cursor within the content; normal
 *                                        text editing applies
 *
 * Editing the delimiters themselves maps onto this model as deletion and
 * re-creation rather than character mutation:
 *
 *   - Backspace in the "adjacent after" position deletes the CLOSING
 *     delimiter: the node unwraps into literal text that still carries its
 *     opening delimiter ("*hello*" -> "*hello"), exactly like erasing the
 *     last character of hand-typed markdown.
 *   - Backspace at the very start of the content deletes the OPENING
 *     delimiter ("*|hello*" -> "|hello*"); Delete (forward) mirrors both.
 *   - Typing the delimiter character again re-forms the node from that
 *     literal text (see findRunOpen below + the autopair plugins), so a
 *     deleted delimiter is always recoverable by just retyping it.
 *   - Backspace/Delete on an EMPTY shell removes the whole pair at once,
 *     like erasing an auto-closed bracket.
 *
 * Why every boundary crossing is intercepted in handleKeyDown instead of
 * left to the browser: the synthesized delimiters aren't real text, so
 * native caret movement either stalls against them or - in WKWebView, the
 * Tauri webview - gets silently normalized to the wrong side of the node
 * element. The same normalization also mis-attributes text typed at a
 * boundary to the node's content; redirectMisattributedInput below is the
 * counterpart guard for that, called by the autopair plugins.
 *
 * Division of labor across the feature's files:
 *   - *-schema.ts:          node shape, markdown parse/serialize
 *   - *-autopair-plugin.ts: what typing a delimiter character does (open /
 *     upgrade / close / convert literal text), via the helpers exported here
 *   - enclosure.ts:         cursor phases, delimiter reveal, delimiter
 *     deletion - everything selection- and key-driven, uniformly
 *   - math-preview-plugin.ts: math-only extras (KaTeX render while away,
 *     floating live preview while inside)
 */

const enclosureKey = new PluginKey("enclosure");

/** Inline nodes kept as their source text (markdown/wikilink.ts,
 *  images/obsidian-embed.ts, html/raw-html-schema.ts): no delimiters, but
 *  text typed right after one lands in it the same way - "[[Note]] and"
 *  typed by hand linked to "Note]] and", and "<b>x" went into the tag. */
const SOURCE_INLINE_NODES = new Set(["wikilink", "obsidian_embed", "html"]);

/**
 * WKWebView (the Tauri webview) normalizes a caret sitting just outside an
 * inline element's boundary to just inside it, so text typed right after
 * exiting an enclosure - editor selection in the paragraph - arrives
 * attributed to a position inside the node's content, silently pulling the
 * input (and the cursor) back in. When the reported input position is
 * inside an enclosure but the editor's actual selection is not, re-route
 * the input through the full handler chain at the real caret position (so
 * a delimiter character still gets its normal autopair treatment there).
 * Every autopair plugin calls this first from its handleTextInput.
 */
export function redirectMisattributedInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  // During IME composition the intermediate text (e.g. pinyin) lives in the
  // DOM ahead of the editor state, so from/selection routinely disagree for
  // reasons that have nothing to do with WKWebView misattribution - and
  // dispatching here aborts the composition, committing the raw letters
  // alongside the text the IME inserts on its own.
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
  if (sel.from > nodeStart && sel.from < nodeEnd) return false; // genuinely typing inside
  const deflt = () => state.tr.insertText(text, sel.from, sel.to);
  const handled = view.someProp("handleTextInput", (f) =>
    f(view, sel.from, sel.to, text, deflt),
  );
  if (!handled) view.dispatch(deflt());
  return true;
}

/**
 * Whether a keydown belongs to an active IME composition (candidate
 * navigation, commit via Enter/Space, editing the preedit with Backspace).
 * Every handleKeyDown in the editor must bail on these - intercepting them
 * aborts the composition, which commits the raw preedit letters into the
 * document on top of the text the IME then inserts. keyCode 229 covers
 * WebKit's "processed by IME" keydowns where isComposing can lag.
 */
export function isImeKeyEvent(view: EditorView, event: KeyboardEvent): boolean {
  return view.composing || event.isComposing || event.keyCode === 229;
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

  // Only enclosures the cursor touches are decorated - inside, or adjacent
  // on either side - so only the selection, widened a position or two each
  // way for adjacency, needs walking. This runs on every keystroke and
  // every arrow press; it used to walk the whole document each time.
  const { selection, doc } = state;
  // Two for a span nested whole, touched through its outer one.
  const scanFrom = Math.max(0, selection.from - 2);
  const scanTo = Math.min(doc.content.size, selection.to + 2);
  doc.nodesBetween(scanFrom, scanTo, (node, pos, parent) => {
    if (!isEnclosure(node)) return;
    const from = pos;
    const to = pos + node.nodeSize;
    // A span that is all of another's (bold-italic, `***x***`, is italic
    // around bold) shows its delimiters with the outer one's: one `***`
    // pair, not `*` first and `**` a press later.
    const whole = !!parent && isSoleEnclosureChild(parent);
    if (
      !cursorTouches(state.selection, from, to) &&
      !(whole && cursorTouches(state.selection, from - 1, to + 1))
    )
      return;

    // Real widget elements, not CSS ::before/::after pseudo-content:
    // WKWebView draws the caret on the wrong visual side of generated
    // content, while real elements give it an unambiguous DOM position on
    // each side. Widgets at these positions used to trap native left/right
    // movement, but handleKeyDown below hops the caret across every
    // boundary itself, so native navigation never has to cross them.
    //
    // For INLINE enclosures the widgets sit OUTSIDE the node (at from/to in
    // the parent paragraph), not inside it at the content edges. WebKit
    // cannot compute a caret rectangle for a position whose only neighbor
    // is contentEditable=false content - the DOM selection is correct but
    // the caret gets PAINTED at the start of the line (typing still lands
    // at the right document position, which is how you can tell it apart
    // from a logical-position bug). prosemirror-view works around exactly
    // this (#1165) by inserting an <img class="ProseMirror-separator">
    // anchor when a textblock's last child is uneditable - but it only
    // looks at the textblock's direct children, so the widgets must live
    // in the paragraph itself, not be tucked inside the enclosure node,
    // for that workaround to engage.
    //
    // math_block is the exception: it's a block node, so it gets a node
    // decoration (.math-block-revealed in milkdown-theme.css, a bordered
    // panel around the source) instead of inline delimiter widgets - inline
    // widgets would squeeze onto one line with the source, and the content
    // area must keep a real line box of its own so the caret has somewhere
    // to sit even while the block is empty.
    const { open, close } = enclosureDelims(node);
    if (node.isBlock) {
      decorations.push(
        Decoration.node(from, to, { class: "math-block-revealed" }),
      );
    } else {
      // side: 1 on the opener / side: -1 on the closer keeps the caret at
      // the node's outer boundary visually OUTSIDE the delimiters (the
      // "adjacent" phase in the diagram above), and makes text typed there
      // land outside the enclosure too.
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

/**
 * Pure decision logic below (computeArrowRight / computeArrowLeft /
 * computeBackspace / computeDelete): given only an EditorState, each either
 * returns null ("not our concern, let the default/native behavior run") or
 * describes exactly what should happen. None of them touch a view or
 * dispatch a transaction - that's left to the thin plugin wiring at the
 * bottom, which is what makes these directly unit-testable against a plain
 * prosemirror-state EditorState with no browser/DOM involved at all (see
 * enclosure.test.ts). Given how many of this feature's bugs have turned out
 * to be off-by-one position math, that direct testability is the point.
 */

const wordSegmenter: Intl.Segmenter | undefined =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : undefined;

/**
 * The word at `pos` inside a bold or italic span - the span's own text, cut
 * at word boundaries as a double click would cut it (Intl.Segmenter, so
 * Chinese too) - as document positions; null outside a span of plain text,
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
  // Between one span's edge and another's inside it - bold-italic,
  // `***x***`, is italic around bold - the word is in the inner one.
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

/** How close in time and place the second press of a double click is to
 *  the first. */
const DOUBLE_CLICK_MS = 600;
const DOUBLE_CLICK_PX = 6;

export const enclosurePlugin = $prose(() => {
  let compositionAnchors: CompositionAnchor[] = [];
  // Where the first press of a possible double click landed, read before
  // it put the caret in a span and so revealed its delimiters.
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
      // Dev-only escape hatch: WKWebView/caret bugs in this feature keep
      // needing to be poked at from a console, and the EditorView isn't
      // reachable from the DOM otherwise.
      if (import.meta.env.DEV)
        (window as Window & { __pmView?: EditorView }).__pmView = editorView;
      return {};
    },
    props: {
      decorations(state) {
        return enclosureKey.getState(state);
      },
      handleDOMEvents: {
        // A double click on a bold or italic word selects that word. The
        // first press puts the caret in the span, which reveals its `**`
        // around it and moves the text along; WebKit then takes the
        // second press for wherever the text went, a delimiter or the
        // next word, and selected nothing or the wrong word. The word is
        // the one under the first press.
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
          // prosemirror-view flushes the final composition change slightly
          // after this event (scheduleComposeEnd ~20ms); relocate only once
          // the committed text is actually in the state.
          setTimeout(
            () => relocateComposedText(view, anchors),
            COMPOSE_RELOCATE_DELAY_MS,
          );
          return false;
        },
      },
      handleKeyDown(view, event) {
        if (isImeKeyEvent(view, event)) return false;
        // Modified keys are line/word-level commands (Cmd+Backspace =
        // delete to line start, Alt+Arrow = word hop, Shift+Arrow =
        // extend selection) - never reinterpret those as the single
        // caret-phase steps below.
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
