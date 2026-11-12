import type { EditorView as CmView } from "@codemirror/view";

/**
 * Keeping your place across a source/WYSIWYG switch. The views share no
 * coordinates, so the bridge is an offset into the markdown plus how far
 * down the pane the caret sat. It is approximate where markdown syntax and
 * document structure disagree, by a few characters at most.
 */
export interface ModeSwitchCaret {
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
