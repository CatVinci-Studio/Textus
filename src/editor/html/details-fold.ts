import { PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { Mapping } from "@milkdown/kit/prose/transform";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  caretToSourceOnClick,
  type RevealState,
  type Touches,
} from "../reveal-state";
import { liveCaretPos } from "../live-selection";
import { renderWhitelistedHtml } from "./raw-html-sanitize";

// The folding half of the raw-HTML preview. The plugin's state holds the
// fold state too, so its key and shape are declared here.

/** Folded state per <details>, by its head paragraph's position. */
export type OpenStates = Map<number, boolean>;

export interface RawHtmlPreviewState {
  reveal: RevealState;
  open: OpenStates;
  spans: DetailsSpan[];
}

export const rawHtmlPreviewKey = new PluginKey<RawHtmlPreviewState>(
  "raw-html-preview",
);

/** What the plugin's state takes to open or fold: [head position, open]. */
export type FoldMeta = { set: [number, boolean][] };

// What the fold draws. An export reads them back to put a body inside its
// <details> again.
export const DETAILS_CLASS_PREFIX = "raw-html-details-";
export const DETAILS_HEAD_CLASS = "raw-html-details-head";
export const DETAILS_END_CLASS = "raw-html-details-end";
export const DETAILS_FOLDED_CLASS = "raw-html-details-folded";
/** Followed by a head's position: the <details> a body block belongs to. */
export const DETAILS_IN_CLASS = "raw-html-details-in-";
/** On the head widget's <details>: that head's position. */
export const DETAILS_HEAD_ATTR = "data-details-head";

export interface HtmlChild {
  from: number;
  to: number;
  text: string;
}

export function inSummary(event: Event): boolean {
  return (
    event.target instanceof Element && event.target.closest("summary") !== null
  );
}

// ProseMirror leaves a summary's clicks to the browser, which toggles it,
// instead of placing the caret there (which would reveal the source).
export function widgetSpec(key: string) {
  return { side: -1, key, stopEvent: inSummary };
}

const DETAILS_OPEN_RE = /^<details[\s>]/i;
const DETAILS_CLOSE_RE = /^<\/details\s*>$/i;

/** A top-level paragraph that is one HTML node, and that node. */
function loneHtml(node: ProseNode, pos: number): HtmlChild | null {
  if (node.type.name !== "paragraph" || node.childCount !== 1) return null;
  const child = node.firstChild!;
  if (child.type.name !== "html") return null;
  return {
    from: pos + 1,
    to: pos + 1 + child.nodeSize,
    text: child.textContent,
  };
}

export interface DetailsSpan {
  /** The paragraph holding "<details><summary>…</summary>". */
  headPos: number;
  head: HtmlChild;
  /** Where the blocks between start, and where "</details>"'s paragraph is. */
  bodyFrom: number;
  endPos: number;
  end: HtmlChild;
  endSize: number;
}

/**
 * GitHub's usual way to fold markdown: "<details><summary>" in one HTML
 * block, the markdown, and "</details>" alone. These are separate top-level
 * paragraphs, so the pair is matched there (nested pairs included).
 */
export function findDetailsSpans(doc: ProseNode): DetailsSpan[] {
  const spans: DetailsSpan[] = [];
  const stack: { pos: number; size: number; head: HtmlChild }[] = [];
  doc.forEach((node, pos) => {
    const html = loneHtml(node, pos);
    if (!html) return;
    const text = html.text.trim();
    if (DETAILS_OPEN_RE.test(text) && !/<\/details\s*>/i.test(text)) {
      stack.push({ pos, size: node.nodeSize, head: html });
    } else if (DETAILS_CLOSE_RE.test(text)) {
      const open = stack.pop();
      if (open)
        spans.push({
          headPos: open.pos,
          head: open.head,
          bodyFrom: open.pos + open.size,
          endPos: pos,
          end: html,
          endSize: node.nodeSize,
        });
    }
  });
  return spans;
}

/** `spans` through an edit that left them as they were. */
export function mapSpans(
  spans: DetailsSpan[],
  mapping: Mapping,
): DetailsSpan[] {
  if (spans.length === 0) return spans;
  const html = (h: HtmlChild): HtmlChild => ({
    from: mapping.map(h.from),
    to: mapping.map(h.to),
    text: h.text,
  });
  return spans.map((span) => ({
    headPos: mapping.map(span.headPos),
    head: html(span.head),
    bodyFrom: mapping.map(span.bodyFrom),
    endPos: mapping.map(span.endPos),
    end: html(span.end),
    endSize: span.endSize,
  }));
}

/** Whether redrawing the top-level block [from, to] could change a fold:
 *  it is in one, or it is a "<details>" or "</details>" line. */
export function detailsTouched(
  doc: ProseNode,
  spans: DetailsSpan[],
  from: number,
  to: number,
): boolean {
  if (spans.some((s) => from <= s.endPos + s.endSize && to >= s.headPos))
    return true;
  const node = doc.nodeAt(from);
  const html = node && loneHtml(node, from);
  if (!html) return false;
  const text = html.text.trim();
  return DETAILS_OPEN_RE.test(text) || DETAILS_CLOSE_RE.test(text);
}

/** Open as the reader left it, or else as written (`<details open>`). */
function isFoldOpen(span: DetailsSpan, open: OpenStates): boolean {
  return (
    open.get(span.headPos) ??
    /^<details\b[^>]*\sopen\b/i.test(span.head.text.trim())
  );
}

/**
 * Something another plugin points the writer at (a proposed edit), declared
 * on its spec as `foldAttention`. A fold opens when a new key lands in its
 * hidden text.
 */
export interface FoldAttentionItem {
  key: string;
  from: number;
  to: number;
}
export type FoldAttention = (
  state: EditorState,
) => readonly FoldAttentionItem[];

function attentionItems(state: EditorState): FoldAttentionItem[] {
  const items: FoldAttentionItem[] = [];
  for (const plugin of state.plugins) {
    const read = (plugin.spec as { foldAttention?: FoldAttention })
      .foldAttention;
    if (read) items.push(...read(state));
  }
  return items;
}

const UNFOLD_META = "details-unfold";

/** The folded <details> whose hidden text holds part of [from, to]. */
function foldsHiding(
  spans: DetailsSpan[],
  open: OpenStates,
  from: number,
  to: number,
): number[] {
  return spans
    .filter(
      (s) =>
        s.endPos > s.bodyFrom &&
        from < s.endPos &&
        to > s.bodyFrom &&
        !isFoldOpen(s, open),
    )
    .map((s) => s.headPos);
}

/**
 * Opens every folded <details> hiding [from, to], so a find match or jump
 * lands on visible text. True if it dispatched.
 */
export function unfoldRange(
  view: EditorView,
  from: number,
  to: number = from,
): boolean {
  const plugin = rawHtmlPreviewKey.getState(view.state);
  if (!plugin) return false;
  const heads = foldsHiding(plugin.spans, plugin.open, from, to);
  if (heads.length === 0) return false;
  view.dispatch(view.state.tr.setMeta(UNFOLD_META, { from, to }));
  return true;
}

const UNFOLD_EVENT = "textus-unfold";

/** unfoldRange for an element of the editor's own DOM. */
export function unfoldElement(el: Element): void {
  el.dispatchEvent(new CustomEvent(UNFOLD_EVENT, { bubbles: true }));
}

/** The plugin's handleDOMEvents entry that answers unfoldElement. */
export const unfoldEventHandlers = {
  [UNFOLD_EVENT]: (view: EditorView, event: Event) => {
    if (!(event.target instanceof Node)) return false;
    const pos = view.posAtDOM(event.target, 0);
    unfoldRange(view, pos);
    return true;
  },
};

/**
 * The folds to open after these transactions: one hiding the selection, one
 * unfoldRange asked for, one where a new attention item landed.
 */
export function unfoldFor(
  trs: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
): FoldMeta | null {
  const plugin = rawHtmlPreviewKey.getState(newState);
  if (!plugin || plugin.spans.length === 0) return null;
  const { open, spans } = plugin;
  const ranges: [number, number][] = [];
  if (trs.some((tr) => tr.selectionSet || tr.docChanged))
    ranges.push([newState.selection.from, newState.selection.to]);
  for (const tr of trs) {
    const unfold = tr.getMeta(UNFOLD_META) as
      { from: number; to: number } | undefined;
    if (unfold) ranges.push([unfold.from, unfold.to]);
  }
  const seen = new Set(attentionItems(oldState).map((item) => item.key));
  for (const item of attentionItems(newState))
    if (!seen.has(item.key)) ranges.push([item.from, item.to]);

  const heads = new Set<number>();
  for (const [from, to] of ranges)
    for (const head of foldsHiding(spans, open, from, to)) heads.add(head);
  if (heads.size === 0) return null;
  return { set: [...heads].map((head) => [head, true]) };
}

/** ArrowUp/Down into a paragraph that is all HTML drawn as a block or
 *  hidden: the browser skipped it, so the caret goes into the source. */
export function arrowIntoHtmlBlock(
  view: EditorView,
  event: KeyboardEvent,
): boolean {
  const dir =
    event.key === "ArrowDown" ? "down" : event.key === "ArrowUp" ? "up" : null;
  if (!dir || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)
    return false;
  const { selection, doc } = view.state;
  // The browser's caret: a key right after a native caret move can arrive
  // before the state has read that move.
  let head = selection.head;
  const dom = (view.root as Document).getSelection?.();
  if (dom?.focusNode && view.dom.contains(dom.focusNode)) {
    if (!dom.isCollapsed) return false;
    // Not a position the editor knows: keep the state's.
    head = liveCaretPos(view) ?? head;
  } else if (!selection.empty) return false;
  const $head = doc.resolve(head);
  if ($head.depth !== 1 || !view.endOfTextblock(dir)) return false;
  const index = $head.index(0) + (dir === "down" ? 1 : -1);
  if (index < 0 || index >= doc.childCount) return false;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  const html = loneHtml(doc.child(index), pos);
  if (!html) return false;
  const target = dir === "down" ? html.from + 1 : html.to - 1;
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(doc, target))
      .scrollIntoView(),
  );
  return true;
}

function detailsHeadWidget(html: string, open: boolean, headPos: number) {
  return (view: EditorView, getPos: () => number | undefined) => {
    const el = document.createElement("div");
    caretToSourceOnClick(el, view, getPos, inSummary);
    el.className = `raw-html-rendered ${DETAILS_HEAD_CLASS}`;
    el.innerHTML = html;
    const details = el.querySelector("details");
    if (details) {
      details.open = open;
      details.setAttribute(DETAILS_HEAD_ATTR, String(headPos));
    }
    // The body is the paragraphs below, not the element's children, so
    // the toggle goes through the editor state instead of the browser.
    el.addEventListener("click", (event) => {
      if (!inSummary(event)) return;
      event.preventDefault();
      view.dispatch(
        view.state.tr
          .setMeta(rawHtmlPreviewKey, { set: [[headPos, !open]] } as FoldMeta)
          .setMeta("addToHistory", false),
      );
    });
    return el;
  };
}

/** Draws every <details> around markdown, and adds the HTML nodes it drew
 *  to `handled` so the inline pass leaves them alone. */
export function decorateDetails(
  state: EditorState,
  spans: DetailsSpan[],
  open: OpenStates,
  touches: Touches,
  decorations: Decoration[],
  handled: Set<number>,
) {
  // A folded outer one hides every block inside, inner heads included.
  for (const span of spans) {
    handled.add(span.head.from);
    handled.add(span.end.from);
    const onHead = touches(span.head.from, span.head.to);
    const onEnd = touches(span.end.from, span.end.to);
    const rendered = renderWhitelistedHtml(span.head.text);
    // The caret in the folded text opens it for good.
    const showBody = isFoldOpen(span, open) || onHead || onEnd || !rendered;

    if (rendered && !onHead && !onEnd) {
      decorations.push(
        Decoration.inline(span.head.from + 1, span.head.to - 1, {
          class: "raw-html-source-hidden",
        }),
        Decoration.widget(
          span.head.to,
          detailsHeadWidget(rendered.html, showBody, span.headPos),
          widgetSpec(
            `details\n${span.headPos}\n${showBody}\n${span.head.text}`,
          ),
        ),
        // "</details>" says nothing to the reader; its line goes too.
        Decoration.node(span.endPos, span.endPos + span.endSize, {
          class: DETAILS_END_CLASS,
        }),
      );
    }
    // Every body block says whose it is, so an export can put them back inside
    // the <details>.
    state.doc.nodesBetween(span.bodyFrom, span.endPos, (node, pos) => {
      if (pos < span.bodyFrom || pos >= span.endPos) return false;
      const classes = [`${DETAILS_IN_CLASS}${span.headPos}`];
      if (!showBody) classes.push(DETAILS_FOLDED_CLASS);
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: classes.join(" "),
        }),
      );
      return false;
    });
  }
}

export function mapOpen(open: OpenStates, tr: Transaction): OpenStates {
  if (!tr.docChanged || open.size === 0) return open;
  const mapped: OpenStates = new Map();
  open.forEach((value, pos) => {
    const result = tr.mapping.mapResult(pos);
    if (!result.deleted) mapped.set(result.pos, value);
  });
  return mapped;
}
