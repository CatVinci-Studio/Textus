import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { Fragment } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import type {
  EditorState,
  Selection,
  Transaction,
} from "@milkdown/kit/prose/state";
import type { Node as ProseNode, ResolvedPos } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { spanDelimText } from "./md-span-schema";

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

const ENCLOSURE_NODES = new Set([
  "md_span",
  "md_code_span",
  "math_inline",
  "math_block",
]);

export function isEnclosureName(name: string): boolean {
  return ENCLOSURE_NODES.has(name);
}

function isEnclosure(node: ProseNode): boolean {
  return ENCLOSURE_NODES.has(node.type.name);
}

/** The literal delimiter text an enclosure node's syntax is rendered as. */
function enclosureDelimText(node: ProseNode): string {
  if (node.type.name === "math_inline") return "$";
  if (node.type.name === "math_block") return "$$";
  return spanDelimText(node);
}

/**
 * Whether the selection is inside OR immediately adjacent to the node's
 * outer bounds. Adjacency counts as "touching" so the delimiters stay
 * revealed while the cursor sits just outside them - the intermediate phase
 * that makes them addressable (and deletable) at all. Both the reveal
 * decorations here and math-preview's "render KaTeX instead" check must use
 * this same predicate or the two representations would overlap.
 */
export function cursorTouches(
  selection: Selection,
  from: number,
  to: number,
): boolean {
  return selection.from <= to && selection.to >= from;
}

/**
 * The contiguous run of plain text directly before $pos within its parent,
 * stopping at any non-text inline node. Backward-pairing must only ever
 * look at this run: parent.textContent-based slicing counts characters
 * while document positions count node boundaries too, so the two drift
 * apart as soon as the paragraph contains any enclosure node - and pairing
 * across an existing node would be wrong anyway.
 */
export function literalTextBefore($pos: ResolvedPos): {
  text: string;
  from: number;
} {
  const parent = $pos.parent;
  let offset = $pos.parentOffset;
  let text = "";
  while (offset > 0) {
    const child = parent.childBefore(offset);
    if (!child.node || !child.node.isText) break;
    text = (child.node.text ?? "").slice(0, offset - child.offset) + text;
    offset = child.offset;
  }
  return { text, from: $pos.start() + offset };
}

/** Mirror of literalTextBefore: the contiguous run of plain text directly
 *  after $pos, stopping at any non-text inline node. */
export function literalTextAfter($pos: ResolvedPos): { text: string } {
  const parent = $pos.parent;
  let offset = $pos.parentOffset;
  let text = "";
  while (offset < parent.content.size) {
    const child = parent.childAfter(offset);
    if (!child.node || !child.node.isText) break;
    text += (child.node.text ?? "").slice(offset - child.offset);
    offset = child.offset + child.node.nodeSize;
  }
  return { text };
}

/** The value a delimiter pair may enclose: non-empty, no whitespace at its
 *  edges, no delimiter characters inside. Shared by every run-pairing rule
 *  (findRunOpen / hasPendingRunOpen / findRunClose) so backward and forward
 *  pairing can never disagree on what makes a valid enclosure. */
function isValidRunValue(value: string, char: string): boolean {
  return value.length > 0 && !/^\s|\s$/.test(value) && !value.includes(char);
}

/**
 * Looks for an unclosed opening run of exactly `rung` delimiter characters
 * in `textBefore` that the character being typed right now would complete -
 * requiring the previously-typed part of the closing run (rung - 1 literal
 * characters) to sit directly before the caret. Both runs must be exact
 * (not the tail of a longer run), and the enclosed value must be non-empty
 * with no whitespace at its edges and no delimiter characters inside. This
 * is what lets literal "**hello"-looking text - left by deleting a
 * delimiter, a paste, or an abandoned edit - re-form into a real node when
 * its closing delimiter is (re)typed.
 */
export function findRunOpen(
  textBefore: string,
  char: string,
  rung: number,
): { openIdx: number; value: string } | null {
  const closerStart = textBefore.length - (rung - 1);
  if (closerStart < 0) return null;
  if (textBefore.slice(closerStart) !== char.repeat(rung - 1)) return null;
  if (textBefore[closerStart - 1] === char) return null; // tail of a longer literal run - not this rung's closer
  const body = textBefore.slice(0, closerStart);
  const openIdx = body.lastIndexOf(char.repeat(rung));
  if (openIdx === -1) return null;
  if (body[openIdx - 1] === char || body[openIdx + rung] === char) return null; // embedded in a longer run
  const value = body.slice(openIdx + rung);
  if (!isValidRunValue(value, char)) return null;
  return { openIdx, value };
}

/**
 * Forward mirror of findRunOpen: the character being typed right now
 * completes an OPENING run of exactly `rung` characters (the other rung - 1
 * sit directly before the caret, typed just previously), and a closing run
 * of exactly the same length already waits in the literal text ahead - the
 * "add the delimiters around existing content, front first" direction.
 * Runs must match in exact length: with "hello**" ahead, the first "*"
 * typed in front stays literal (1 vs 2) and the second completes the pair.
 * The cost of that determinism: with "hello*" ahead a single "*" pairs to
 * italic immediately, even if the user meant to keep going to bold - an
 * inherently ambiguous input either way.
 */
export function findRunClose(
  textBefore: string,
  textAfter: string,
  char: string,
  rung: number,
): { valueLen: number } | null {
  const openStart = textBefore.length - (rung - 1);
  if (openStart < 0) return null;
  if (textBefore.slice(openStart) !== char.repeat(rung - 1)) return null;
  if (textBefore[openStart - 1] === char) return null; // tail of a longer literal run
  const closeIdx = textAfter.indexOf(char.repeat(rung));
  if (closeIdx === -1) return null;
  if (textAfter[closeIdx + rung] === char) return null; // part of a longer run ahead
  const value = textAfter.slice(0, closeIdx);
  if (!isValidRunValue(value, char)) return null;
  return { valueLen: closeIdx };
}

/**
 * Whether an opening run longer than the characters typed so far is waiting
 * for more closing characters - e.g. "**hello" with one "*" just typed. In
 * that case the typed character must stay literal (building up the closing
 * run one keystroke at a time) instead of opening a fresh unrelated shell,
 * or the multi-character closer could never be typed at all.
 */
export function hasPendingRunOpen(
  textBefore: string,
  char: string,
  minRung: number,
  maxRung: number,
): boolean {
  let trailing = 0;
  while (
    trailing < textBefore.length &&
    textBefore[textBefore.length - 1 - trailing] === char
  )
    trailing++;
  for (let rung = Math.max(minRung, 2); rung <= maxRung; rung++) {
    if (trailing >= rung - 1) continue; // this keystroke already completes that rung (findRunOpen's case)
    const body = textBefore.slice(0, textBefore.length - trailing);
    const openIdx = body.lastIndexOf(char.repeat(rung));
    if (openIdx === -1) continue;
    if (body[openIdx - 1] === char || body[openIdx + rung] === char) continue;
    const value = body.slice(openIdx + rung);
    if (!isValidRunValue(value, char)) continue;
    return true;
  }
  return false;
}

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
  if (!isEnclosureName($typed.parent.type.name)) return false;
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
  // on either side - so only the selection, widened by one position each
  // way for adjacency, needs walking. This runs on every keystroke and
  // every arrow press; it used to walk the whole document each time.
  const { selection, doc } = state;
  const scanFrom = Math.max(0, selection.from - 1);
  const scanTo = Math.min(doc.content.size, selection.to + 1);
  doc.nodesBetween(scanFrom, scanTo, (node, pos) => {
    if (!isEnclosure(node)) return;
    const from = pos;
    const to = pos + node.nodeSize;
    if (!cursorTouches(state.selection, from, to)) return;

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
    const delim = enclosureDelimText(node);
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
        Decoration.widget(from, () => makeDelimiterEl(delim), {
          side: 1,
          key: `enc-open:${delim}`,
        }),
      );
      decorations.push(
        Decoration.widget(to, () => makeDelimiterEl(delim), {
          side: -1,
          key: `enc-close:${delim}`,
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

export interface ArrowMove {
  pos: number;
}

/**
 * Right arrow, one phase at a time (see the phase diagram at the top of
 * this file): inside-at-end -> adjacent-after; adjacent-before ->
 * inside-at-start; and the "pin" case, which forces the single native
 * character-step that would otherwise land adjacent-before to go through
 * us instead (see the module doc comment on why WKWebView can't be trusted
 * to land there on its own).
 */
function computeArrowRight(state: EditorState): ArrowMove | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $pos = sel.$from;
  const pos = sel.from;
  const parent = $pos.parent;

  if (
    isEnclosureName(parent.type.name) &&
    parent.content.size > 0 &&
    $pos.parentOffset === parent.content.size
  ) {
    return { pos: $pos.after($pos.depth) };
  }

  const next = $pos.nodeAfter;
  if (next && isEnclosure(next) && next.content.size > 0) {
    return { pos: pos + 1 };
  }

  if (next?.isText) {
    const upcoming = state.doc.resolve(pos + 1).nodeAfter;
    if (upcoming && isEnclosure(upcoming) && upcoming.content.size > 0) {
      return { pos: pos + 1 };
    }
  }

  // Leaving adjacent-after, moving further away: the position immediately
  // after an enclosure is exactly as ambiguous for WKWebView as the one
  // immediately before it (see the module doc comment) - a widget sits
  // right on the other side of this position too, so this step is taken
  // over rather than ever handed to native movement, symmetric with the
  // "entering" and "pin" cases above.
  const prev = $pos.nodeBefore;
  if (prev && isEnclosure(prev) && next?.isText) {
    return { pos: pos + 1 };
  }

  return null;
}

/** Mirror of computeArrowRight - see its comment for the phase reasoning. */
function computeArrowLeft(state: EditorState): ArrowMove | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $pos = sel.$from;
  const pos = sel.from;
  const parent = $pos.parent;

  if (
    isEnclosureName(parent.type.name) &&
    parent.content.size > 0 &&
    $pos.parentOffset === 0
  ) {
    return { pos: $pos.before($pos.depth) };
  }

  const prev = $pos.nodeBefore;
  if (prev && isEnclosure(prev) && prev.content.size > 0) {
    return { pos: pos - 1 };
  }

  if (prev?.isText) {
    const upcoming = state.doc.resolve(pos - 1).nodeBefore;
    if (upcoming && isEnclosure(upcoming) && upcoming.content.size > 0) {
      return { pos: pos - 1 };
    }
  }

  // Leaving adjacent-before, moving further away - mirror of the
  // ArrowRight case above.
  const next = $pos.nodeAfter;
  if (next && isEnclosure(next) && prev?.isText) {
    return { pos: pos - 1 };
  }

  return null;
}

export type DeleteAction =
  | { kind: "deleteShell"; start: number; node: ProseNode }
  | {
      kind: "deleteDelimiter";
      start: number;
      node: ProseNode;
      drop: "opening" | "closing";
    };

/**
 * Backspace deletes whichever delimiter is immediately to its left: the
 * opening one if the cursor is at the very start of the content, the
 * closing one if the cursor is adjacent right after the node. An empty
 * shell is removed whole either way. Math blocks are excluded from the
 * "delete opening delimiter" case - their multi-line source doesn't unwrap
 * into a paragraph sensibly, so they keep the block-level default instead.
 */
function computeBackspace(state: EditorState): DeleteAction | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $pos = sel.$from;
  const pos = sel.from;
  const parent = $pos.parent;

  if (isEnclosureName(parent.type.name)) {
    const start = $pos.before($pos.depth);
    if (parent.content.size === 0)
      return { kind: "deleteShell", start, node: parent };
    if ($pos.parentOffset === 0 && parent.type.name !== "math_block") {
      return { kind: "deleteDelimiter", start, node: parent, drop: "opening" };
    }
    return null;
  }

  const prev = $pos.nodeBefore;
  if (prev && isEnclosure(prev) && !prev.isBlock) {
    const start = pos - prev.nodeSize;
    if (prev.content.size === 0)
      return { kind: "deleteShell", start, node: prev };
    return { kind: "deleteDelimiter", start, node: prev, drop: "closing" };
  }
  return null;
}

/** Mirror of computeBackspace, deleting to the right instead of the left. */
function computeDelete(state: EditorState): DeleteAction | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $pos = sel.$from;
  const pos = sel.from;
  const parent = $pos.parent;

  if (isEnclosureName(parent.type.name)) {
    const start = $pos.before($pos.depth);
    if (parent.content.size === 0)
      return { kind: "deleteShell", start, node: parent };
    if (
      $pos.parentOffset === parent.content.size &&
      parent.type.name !== "math_block"
    ) {
      return { kind: "deleteDelimiter", start, node: parent, drop: "closing" };
    }
    return null;
  }

  const next = $pos.nodeAfter;
  if (next && isEnclosure(next) && !next.isBlock) {
    if (next.content.size === 0)
      return { kind: "deleteShell", start: pos, node: next };
    return { kind: "deleteDelimiter", start: pos, node: next, drop: "opening" };
  }
  return null;
}

/**
 * Backspace on the one character that directly follows an inline enclosure
 * ("**3**位|" -> "**3**|"), and Delete on the one that directly precedes
 * one. Left to the browser, the deletion leaves the DOM caret normalized
 * into the neighbouring element - at the end (or start) of the bold text,
 * before the revealed closing "**" - and ProseMirror reads that back as a
 * position inside the node, so the next keystroke went bold. Deleting the
 * character ourselves keeps the caret where it was: outside the node,
 * after (or before) its delimiter. Returns the range to delete, or null.
 */
export function computeCharDeleteBesideEnclosure(
  state: EditorState,
  dir: "backward" | "forward",
): { from: number; to: number } | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $pos = sel.$from;
  const text = dir === "backward" ? $pos.nodeBefore : $pos.nodeAfter;
  if (!text?.isText) return null;
  const chars = Array.from(text.text ?? "");
  // Only when a single character separates the caret from the node.
  const char = dir === "backward" ? chars[0] : chars[chars.length - 1];
  if (chars.length !== 1 || !char) return null;
  const from = dir === "backward" ? sel.from - char.length : sel.from;
  const to = from + char.length;
  const $edge = state.doc.resolve(dir === "backward" ? from : to);
  const beside = dir === "backward" ? $edge.nodeBefore : $edge.nodeAfter;
  if (!beside || !isEnclosure(beside) || beside.isBlock) return null;
  return { from, to };
}

/**
 * Backspace/Delete on a RANGE selection that exactly spans an enclosure
 * node's content (selecting all of "hello" in "*hello*" and pressing either
 * key) must not remove the wrapper in the same step - erasing the content
 * should leave an empty, still-bold shell with the cursor inside it, exactly
 * like the empty-shell state computeBackspace/computeDelete already produce
 * for the collapsed-cursor case. A second keypress against that now-empty
 * shell hits the ordinary `content.size === 0` branch in those functions and
 * removes the pair. Two shapes both count as "spans the content": a
 * selection resolved strictly inside the node (both ends share it as their
 * .parent), and one taken from just outside it at the node's own outer
 * bounds (double-click "select word" routinely lands here, since the
 * delimiters are synthesized decorations with no real character of their
 * own to anchor a selection endpoint just inside them).
 */
function computeRangeDeleteInEnclosure(
  state: EditorState,
): { node: ProseNode; nodeStart: number } | null {
  const sel = state.selection;
  if (sel.empty) return null;
  const { from, to } = sel;
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);

  if ($from.parent === $to.parent && isEnclosureName($from.parent.type.name)) {
    const parent = $from.parent;
    const nodeStart = $from.before($from.depth);
    const contentStart = nodeStart + 1;
    const contentEnd = contentStart + parent.content.size;
    if (parent.content.size > 0 && from === contentStart && to === contentEnd) {
      return { node: parent, nodeStart };
    }
    return null;
  }

  const node = state.doc.nodeAt(from);
  if (
    node &&
    isEnclosure(node) &&
    node.content.size > 0 &&
    to === from + node.nodeSize
  ) {
    return { node, nodeStart: from };
  }

  return null;
}

/** Apply computeRangeDeleteInEnclosure's result: strip the node's content,
 *  leave the (now empty) node in place, caret inside it. */
function emptyEnclosureContent(
  view: EditorView,
  node: ProseNode,
  nodeStart: number,
): void {
  const contentStart = nodeStart + 1;
  const tr = view.state.tr.delete(
    contentStart,
    contentStart + node.content.size,
  );
  tr.setSelection(TextSelection.create(tr.doc, contentStart));
  view.dispatch(tr);
}

function setCaret(view: EditorView, pos: number): void {
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
  );
}

/**
 * Collapse the transaction's selection to `pos` (resolved against the
 * transaction's own, post-edit doc). Every enclosure-creating edit places
 * the caret through this, keeping the placement convention in one place:
 *   - opening a fresh empty shell         -> inside, at content start
 *   - completing a pair around content
 *     (forward pairing, Cmd+B on a caret) -> inside, at content start
 *   - closing/converting behind the caret
 *     (findRunOpen, typing the closer)    -> after the node
 *   - wrapping a selection                -> after the node
 */
export function caretAt(tr: Transaction, pos: number): Transaction {
  return tr.setSelection(TextSelection.create(tr.doc, pos));
}

/**
 * Where the browser's caret is, as a document position: null when the DOM
 * selection isn't a caret (none, or a range) or isn't at a position the
 * editor knows. See stateWithLiveSelection for why the state's own can lag.
 */
export function liveCaretPos(view: EditorView): number | null {
  // ShadowRoot.getSelection is nonstandard (Blink-only), hence the guard.
  const root = view.root as {
    getSelection?: () => globalThis.Selection | null;
  };
  const domSel = root.getSelection ? root.getSelection() : null;
  if (
    !domSel ||
    domSel.rangeCount === 0 ||
    !domSel.isCollapsed ||
    !domSel.anchorNode
  )
    return null;
  try {
    return view.posAtDOM(domSel.anchorNode, domSel.anchorOffset);
  } catch {
    return null;
  }
}

/**
 * The editor state's selection can lag behind the real DOM caret: native
 * caret movement (the in-content steps deliberately left to the browser)
 * only reaches ProseMirror through an asynchronous selectionchange
 * readback, so a keystroke arriving shortly after one - key repeat, fast
 * arrowing - runs against a state.selection that's one or more steps
 * behind where the caret actually sits. prosemirror-view's own keydown
 * path has the same gap (its forceFlush only runs flushes that are
 * already scheduled). Every decision this plugin makes is position math
 * around the caret, so a stale position makes a boundary crossing that
 * should have been intercepted silently fall through to native movement -
 * which is exactly the movement that misbehaves next to the delimiter
 * widgets. This reads the caret straight out of the DOM and, when it
 * disagrees with the state, returns a state whose selection is corrected
 * to match.
 */
export function stateWithLiveSelection(view: EditorView): EditorState {
  const { state } = view;
  if (!state.selection.empty) return state;
  const pos = liveCaretPos(view);
  if (
    pos === null ||
    pos < 0 ||
    pos > state.doc.content.size ||
    pos === state.selection.from
  )
    return state;
  const $pos = state.doc.resolve(pos);
  return state.apply(state.tr.setSelection(TextSelection.between($pos, $pos)));
}

/** Remove an empty shell entirely, like erasing an auto-closed bracket pair. */
function deleteShell(view: EditorView, start: number, node: ProseNode): void {
  const tr = view.state.tr.delete(start, start + node.nodeSize);
  tr.setSelection(TextSelection.create(tr.doc, start));
  view.dispatch(tr);
}

/**
 * Delete one of a node's delimiters: the wrapper is no longer closed, so
 * the node unwraps into literal text that still carries the delimiter that
 * was NOT deleted ("*hello*" minus its closer -> literal "*hello"). Inner
 * nodes in the content survive as nodes. Retyping the deleted delimiter
 * re-forms the enclosure via the autopair plugins' findRunOpen path.
 */
function deleteDelimiter(
  view: EditorView,
  start: number,
  node: ProseNode,
  drop: "opening" | "closing",
): void {
  const { state } = view;
  const delimText = state.schema.text(enclosureDelimText(node));
  const frag =
    drop === "closing"
      ? Fragment.from(delimText).append(node.content)
      : node.content.append(Fragment.from(delimText));
  const tr = state.tr.replaceWith(start, start + node.nodeSize, frag);
  tr.setSelection(
    TextSelection.create(
      tr.doc,
      drop === "closing" ? start + frag.size : start,
    ),
  );
  view.dispatch(tr);
}

function applyDeleteAction(view: EditorView, action: DeleteAction): void {
  if (action.kind === "deleteShell")
    deleteShell(view, action.start, action.node);
  else deleteDelimiter(view, action.start, action.node, action.drop);
}

/**
 * IME counterpart to redirectMisattributedInput. The same WKWebView caret
 * normalization that pulls plain keystrokes into an adjacent enclosure also
 * pulls IME composition text in - but during composition nothing may
 * dispatch (it would abort the preedit and commit the raw pinyin, see
 * redirectMisattributedInput's guard). So the fix runs bracketed around the
 * composition instead: at compositionstart, snapshot any enclosure the
 * caret sits directly against; after compositionend, if the committed text
 * ended up inside that node, move it back out to where the caret actually
 * was. Every check below bails silently when the doc doesn't match the
 * snapshot exactly - a missed relocation is far better than mangling text.
 */
interface CompositionAnchor {
  side: "before" | "after";
  nodeStart: number;
  contentSize: number;
}

function snapshotAdjacentEnclosures(state: EditorState): CompositionAnchor[] {
  const sel = state.selection;
  if (!sel.empty) return [];
  const $pos = sel.$from;
  if (isEnclosureName($pos.parent.type.name)) return []; // genuinely composing inside - leave it there
  const anchors: CompositionAnchor[] = [];
  const before = $pos.nodeBefore;
  if (before && isEnclosure(before) && !before.isBlock) {
    anchors.push({
      side: "after",
      nodeStart: sel.from - before.nodeSize,
      contentSize: before.content.size,
    });
  }
  const after = $pos.nodeAfter;
  if (after && isEnclosure(after) && !after.isBlock) {
    anchors.push({
      side: "before",
      nodeStart: sel.from,
      contentSize: after.content.size,
    });
  }
  return anchors;
}

/**
 * First line of defense, before the relocation fallback below: give WKWebView
 * an unambiguous DOM caret position OUTSIDE the enclosure before the IME
 * inserts anything. The normalization that pulls the preedit inside happens
 * because the boundary position (between the delimiter widget and the
 * neighboring text) is ambiguous; collapsing the DOM selection into the
 * adjacent TEXT node at the same document position removes the ambiguity, so
 * the whole composition renders in the paragraph from the first keystroke -
 * no mid-composition bold styling, no post-commit relocation jump. Touching
 * only the DOM selection is composition-safe: nothing is dispatched and no
 * DOM is redrawn.
 */
function pinDomCaretForComposition(
  view: EditorView,
  anchors: CompositionAnchor[],
): void {
  if (anchors.length !== 1) return; // caret between two enclosures - no text node to anchor into
  const bias = anchors[0].side === "after" ? 1 : -1; // lean away from the enclosure
  const sel = view.state.selection;
  let domPos: { node: globalThis.Node; offset: number };
  try {
    domPos = view.domAtPos(sel.from, bias);
  } catch {
    return;
  }
  if (domPos.node.nodeType !== Node.TEXT_NODE) return; // only a real text position is unambiguous
  const root = view.root as {
    getSelection?: () => globalThis.Selection | null;
  };
  const domSel = root.getSelection ? root.getSelection() : null;
  if (!domSel) return;
  try {
    domSel.collapse(domPos.node, domPos.offset);
  } catch {
    /* leave the fallback relocation to handle it */
  }
}

function relocateComposedText(
  view: EditorView,
  anchors: CompositionAnchor[],
): void {
  const { state } = view;
  const sel = state.selection;
  if (!sel.empty) return;
  const $pos = sel.$from;
  const parent = $pos.parent;
  if (!isEnclosureName(parent.type.name)) return; // the text landed where the caret was - nothing to do
  const nodeStart = $pos.before($pos.depth);

  for (const anchor of anchors) {
    if (anchor.nodeStart !== nodeStart) continue;
    const grown = parent.content.size - anchor.contentSize;
    if (grown <= 0) continue;
    const contentStart = nodeStart + 1;

    if (anchor.side === "after") {
      // Committed text is the tail of the content, caret right after it.
      const from = contentStart + anchor.contentSize;
      const to = contentStart + parent.content.size;
      if (sel.from !== to) continue;
      const text = parent.textBetween(anchor.contentSize, parent.content.size);
      if (text.length !== grown) continue; // non-text content appeared - don't guess
      const tr = state.tr.delete(from, to);
      const insertAt = nodeStart + parent.nodeSize - grown; // right after the shrunk node
      tr.insertText(text, insertAt);
      tr.setSelection(TextSelection.create(tr.doc, insertAt + text.length));
      view.dispatch(tr);
    } else {
      // Mirror case: text got prepended to the content.
      const to = contentStart + grown;
      if (sel.from !== to) continue;
      const text = parent.textBetween(0, grown);
      if (text.length !== grown) continue;
      const tr = state.tr.delete(contentStart, to);
      tr.insertText(text, nodeStart);
      tr.setSelection(TextSelection.create(tr.doc, nodeStart + text.length));
      view.dispatch(tr);
    }
    return;
  }
}

/** How long after compositionend the committed text is moved out of an
 *  adjacent node (relocateComposedText, in compositionend below).
 *  md-span-autopair-plugin.ts waits a little longer, to look after it. */
export const COMPOSE_RELOCATE_DELAY_MS = 30;

export const enclosurePlugin = $prose(() => {
  let compositionAnchors: CompositionAnchor[] = [];
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
        (window as unknown as { __pmView?: EditorView }).__pmView = editorView;
      return {};
    },
    props: {
      decorations(state) {
        return enclosureKey.getState(state);
      },
      handleDOMEvents: {
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
          setCaret(view, move.pos);
          return true;
        }

        if (event.key === "ArrowLeft") {
          const move = computeArrowLeft(state);
          if (!move) return false;
          event.preventDefault();
          setCaret(view, move.pos);
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
