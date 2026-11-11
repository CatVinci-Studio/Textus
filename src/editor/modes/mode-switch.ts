import type { EditorView as CmView } from "@codemirror/view";
import type { Ctx } from "@milkdown/kit/ctx";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { parseMarkdownSource } from "../markdown/parse-markdown-source";

/**
 * Keeping your place across a source/WYSIWYG switch. The views share no
 * coordinates, so the bridge is an offset into the markdown plus how far
 * down the pane the caret sat. It is approximate where markdown syntax and
 * document structure disagree, by a few characters at most.
 */
interface ModeSwitchCaret {
  /** Offset into the tab's markdown. */
  offset: number;
  /** The caret's distance from the top of the visible pane, in screen px;
   *  null when it was off screen. */
  viewportY: number | null;
}

let pending: ModeSwitchCaret | null = null;
let reporter: ((markdown: string) => ModeSwitchCaret | null) | null = null;

/** Handed across exactly one switch: whoever mounts next takes it. */
export function setPendingCaret(caret: ModeSwitchCaret | null): void {
  pending = caret;
}

export function takePendingCaret(): ModeSwitchCaret | null {
  const caret = pending;
  pending = null;
  return caret;
}

/** The on-screen WYSIWYG editor registers how to read its caret. Returns the
 *  unregister function. */
export function registerCaretReporter(
  report: (markdown: string) => ModeSwitchCaret | null,
): () => void {
  reporter = report;
  return () => {
    if (reporter === report) reporter = null;
  };
}

/** `markdown` is the tab's text as the source view shows it: the file's own
 *  spelling, which re-serializing wouldn't reproduce. */
export function captureEditorCaret(markdown: string): ModeSwitchCaret | null {
  return reporter?.(markdown) ?? null;
}

/**
 * Where `prefix` (markdown serialized up to the caret) ends inside
 * `markdown`. The cut closes open structures and escapes can differ, so its
 * last characters are located near the expected spot instead.
 */
export function alignPrefixOffset(prefix: string, markdown: string): number {
  const trimmed = prefix.replace(/\s+$/, "");
  const expected = Math.min(trimmed.length, markdown.length);
  // Longest tail first: the most specific. Shorter ones survive a spelling
  // difference just before the caret (`*x*` serialized where the file has
  // `_x_`).
  for (const length of [32, 16, 8]) {
    const tail = trimmed.slice(-length);
    if (tail.trim().length < 4) continue;
    const before = markdown.lastIndexOf(tail, expected);
    const after = markdown.indexOf(tail, expected);
    const best = [before, after]
      .filter((i) => i >= 0)
      .map((i) => i + tail.length)
      .sort((x, y) => Math.abs(x - expected) - Math.abs(y - expected))[0];
    if (best !== undefined && Math.abs(best - expected) < 400) return best;
  }
  return expected;
}

export function scrollerOf(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>(".editor-scroll");
}

/** ProseMirror reads a click's new DOM selection asynchronously, so a state
 *  read right after a click would hold the old caret. The observer is
 *  prosemirror-view's own, untyped. */
export function flushDomSelection(view: EditorView): void {
  (view as { domObserver?: { flush?: () => void } }).domObserver?.flush?.();
}

/** The WYSIWYG caret as a markdown offset. */
export function readEditorCaret(ctx: Ctx, markdown: string): ModeSwitchCaret {
  const view = ctx.get(editorViewCtx);
  flushDomSelection(view);
  const { doc, selection } = view.state;
  const serialize = ctx.get(serializerCtx);
  const offset = alignPrefixOffset(
    serialize(doc.cut(0, selection.head)),
    markdown,
  );
  let viewportY: number | null = null;
  const scroller = scrollerOf(view.dom);
  try {
    const top = view.coordsAtPos(selection.head).top;
    const box = scroller?.getBoundingClientRect();
    if (box && top >= box.top && top <= box.bottom) viewportY = top - box.top;
  } catch {
    // No layout for that position (hidden): don't restore scroll.
  }
  return { offset, viewportY };
}

/** Places the WYSIWYG caret at a markdown offset. `centre`: with no
 *  `viewportY`, its line goes to the pane's middle rather than a third down. */
export function applyEditorCaret(
  ctx: Ctx,
  markdown: string,
  caret: ModeSwitchCaret,
  centre = false,
): void {
  const prefixDoc = parseMarkdownSource(
    ctx,
    markdown.slice(0, Math.min(caret.offset, markdown.length)),
  );
  let pos = 0;
  prefixDoc?.descendants((node, nodePos) => {
    if (node.isTextblock) pos = nodePos + 1 + node.content.size;
  });
  placeEditorCaret(ctx.get(editorViewCtx), pos, caret.viewportY, centre);
}

/** Places the WYSIWYG caret at document position `pos` and scrolls it to
 *  `viewportY`. */
export function placeEditorCaret(
  view: EditorView,
  pos: number,
  viewportY: number | null,
  centre = false,
): void {
  const { doc } = view.state;
  const at = Math.max(0, Math.min(pos, doc.content.size));
  view.dispatch(
    view.state.tr.setSelection(TextSelection.near(doc.resolve(at))),
  );
  view.focus();
  const scroller = scrollerOf(view.dom);
  if (!scroller) return;
  const head = view.state.selection.head;
  try {
    const coords = view.coordsAtPos(head);
    const box = scroller.getBoundingClientRect();
    const target =
      viewportY ??
      (centre
        ? box.height / 2 - (coords.bottom - coords.top) / 2
        : box.height / 3);
    scroller.scrollTop += coords.top - box.top - target;
  } catch {
    // No layout yet: the caret is set; scrolling is best effort.
  }
}

function zoomOf(el: Element): number {
  return parseFloat(getComputedStyle(el).zoom) || 1;
}

/** The source editor's caret as a markdown offset. CodeMirror measures its
 *  own lines, so the mirror element a textarea needed is gone. */
export function readSourceCaret(view: CmView): ModeSwitchCaret {
  const offset = view.state.selection.main.head;
  const scroller = view.scrollDOM;
  const box = scroller.getBoundingClientRect();
  let viewportY: number | null = null;
  try {
    const coords = view.coordsAtPos(offset);
    if (coords && coords.top >= box.top && coords.top <= box.bottom)
      viewportY = coords.top - box.top;
  } catch {
    // No layout for that position (hidden): don't restore scroll.
  }
  return { offset, viewportY };
}

/** Places the source caret at a markdown offset and scrolls it to where the
 *  WYSIWYG caret was. `coordsAtPos` is in screen px, scrollTop in zoomed
 *  content px, hence the divide. */
export function applySourceCaret(view: CmView, caret: ModeSwitchCaret): void {
  const offset = Math.max(0, Math.min(caret.offset, view.state.doc.length));
  view.dispatch({ selection: { anchor: offset } });
  view.focus();
  const scroller = view.scrollDOM;
  const box = scroller.getBoundingClientRect();
  const target = caret.viewportY ?? box.height / 3;
  const zoom = zoomOf(scroller) || 1;
  try {
    const coords = view.coordsAtPos(offset);
    if (coords) scroller.scrollTop += (coords.top - box.top - target) / zoom;
  } catch {
    // No layout yet: the caret is set; scrolling is best effort.
  }
}

/** Typewriter mode: the caret's line in the middle of the source pane. */
export function centerSourceCaret(view: CmView): void {
  const scroller = view.scrollDOM;
  const box = scroller.getBoundingClientRect();
  const zoom = zoomOf(scroller) || 1;
  try {
    const coords = view.coordsAtPos(view.state.selection.main.head);
    if (coords)
      scroller.scrollTop += (coords.top - box.top - box.height / 2) / zoom;
  } catch {
    // No layout yet.
  }
}
