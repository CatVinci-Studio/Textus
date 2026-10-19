import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { ReviewNote } from "./review-notes-plugin";
import { useViewportClamp } from "../../utils/hooks/useViewportClamp";
import { useLatest } from "../../utils/hooks/useLatest";
import { CARD_WIDTH, GAP, marginRoom } from "./margin-room";
import "./ReviewMargin.css";

export interface ReviewMarginLabels {
  reviewNoteBy: string;
  reviewNoteAsk: string;
  reviewNoteDone: string;
  reviewBarLabel: string;
  proposalTakeSentence: string;
  proposalKeepSentence: string;
  proposalDeleteSentence: string;
  proposalDeletedSentence: string;
}

/** One thing in the margin: a review note, or one changed sentence of a
 *  pending rewrite (its replacement and ✓ / ✕). */
export type MarginItem =
  | { kind: "note"; key: string; note: ReviewNote }
  | {
      kind: "revision";
      key: string;
      callId: string;
      index: number;
      /** Its number among the pending sentences, as the card and bar count. */
      num: number;
      from: number;
      to: number;
      after: string;
      before: string;
      /** Which side the margin shows: the replacement ("original": the
       *  original stays in the text) or the original ("new"). */
      shows: "original" | "new";
      take: boolean | null;
    };

const STACK_GAP = 8;

interface Placed {
  item: MarginItem;
  top: number;
  /** Where the line starts: the end of the passage's first line, in the
   *  layer's coordinates. */
  ax: number;
  ay: number;
}

/** marginRoom for this editor as it is laid out now. */
function measureRoom(
  scrollEl: HTMLElement,
  contentEl: HTMLElement,
  view: EditorView,
) {
  const pm = view.dom as HTMLElement;
  return marginRoom(
    scrollEl.clientWidth,
    contentEl.offsetWidth,
    contentEl.offsetWidth - pm.offsetWidth,
  );
}

/** The marked text an item is about, in the document. */
function anchorSelector(item: MarginItem): string {
  return item.kind === "note"
    ? `.review-anchor[data-note="${CSS.escape(item.note.id)}"]`
    : `[data-call="${CSS.escape(item.callId)}"][data-index="${item.index}"]`;
}

/**
 * The page's margin: review notes and the changed sentences of a pending
 * rewrite, beside the text they are about (review-notes-plugin.ts and
 * pending-edit-plugin.ts mark it). Each card sits level with the first line
 * of its passage, cards that would overlap stack downward, and a thin line
 * runs to the card from the text column's edge, level with that first line
 * - not from the passage's end, which would cross the words after it or,
 * when it wraps, throw the line across the page. Hovering either side
 * lights both.
 *
 * The margin is made, not assumed: when the space right of the text is too
 * narrow the text column moves left to open it (animated, via its margin),
 * and when even that isn't enough - a narrow window, a phone - `onNoMargin`
 * hands everything back to the text: notes behind numbered badges, a
 * rewrite's sentences inline with their ✓ / ✕. Whether one is available
 * is measured with or without anything to show, so the margin views are
 * offered only where they would work.
 */
export function ReviewMargin({
  view,
  items,
  hot,
  focused,
  scrollEl,
  contentEl,
  labels,
  onHot,
  onDone,
  onAsk,
  onDecide,
  onNoMargin,
  layoutKey,
}: {
  /** Anything else that moves text without moving the items: a change
   *  re-measures. */
  layoutKey?: unknown;
  view: EditorView | null;
  items: MarginItem[];
  hot: string | null;
  /** The revision the review bar points at ("rev:<callId>:<index>"). */
  focused: string | null;
  scrollEl: HTMLElement;
  contentEl: HTMLElement;
  labels: ReviewMarginLabels;
  onHot: (key: string | null) => void;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onDecide: (callId: string, index: number, take: boolean | null) => void;
  onNoMargin: (noMargin: boolean) => void;
}) {
  const [layout, setLayout] = useState<{
    left: number;
    placed: Placed[];
  } | null>(null);
  const heights = useRef(new Map<string, number>());
  const [tick, setTick] = useState(0);
  const [noMargin, setNoMargin] = useState(false);
  const onNoMarginRef = useLatest(onNoMargin);

  // Whether a margin is available, cards or no cards: the window, the side
  // panels, the zoom and the text width all change it.
  useLayoutEffect(() => {
    if (!view) return;
    let last: boolean | null = null;
    const check = () => {
      const next = !measureRoom(scrollEl, contentEl, view).available;
      if (next === last) return;
      last = next;
      setNoMargin(next);
      onNoMarginRef.current(next);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(scrollEl);
    ro.observe(contentEl);
    ro.observe(view.dom);
    return () => ro.disconnect();
  }, [view, scrollEl, contentEl, onNoMarginRef]);

  // Measure: where the text ends, where each item's passage is - then
  // stack the cards.
  useLayoutEffect(() => {
    if (!view || noMargin || items.length === 0) {
      contentEl.style.marginLeft = "";
      scrollEl.classList.remove("review-notes-on");
      setLayout(null);
      return;
    }
    const measure = () => {
      const pm = view.dom as HTMLElement;
      const { natural, textRight, shift } = measureRoom(
        scrollEl,
        contentEl,
        view,
      );
      scrollEl.classList.add("review-notes-on");
      contentEl.style.marginLeft = shift > 0 ? `${natural - shift}px` : "";
      const left = textRight - shift + GAP;
      const box = scrollEl.getBoundingClientRect();
      const top0 = box.top - scrollEl.scrollTop;
      // Horizontal positions are taken from the column, wherever its
      // margin transition has it right now, and placed where it is going.
      const column = contentEl.getBoundingClientRect();
      const columnLeft = natural - shift;
      const textEdge =
        pm.getBoundingClientRect().right - column.left + columnLeft;
      const placed: Placed[] = [];
      for (const item of items) {
        // The marked passage's own boxes: a position's coordinates are
        // ambiguous where widgets share it.
        const marks = pm.querySelectorAll<HTMLElement>(anchorSelector(item));
        const rects = [...marks]
          .flatMap((m) => [...m.getClientRects()])
          .filter((r) => r.width > 0 || r.height > 0);
        let first: { top: number; right: number; bottom: number };
        if (rects.length > 0) {
          first = rects[0];
        } else {
          const from = item.kind === "note" ? item.note.from : item.from;
          try {
            first = view.coordsAtPos(from, 1);
          } catch {
            continue;
          }
        }
        placed.push({
          item,
          top: first.top - top0 - 8,
          // From the column's edge, level with the passage's first line -
          // never from inside the text, where it would cross the words
          // after the passage.
          ax: textEdge + 6,
          ay: (first.top + first.bottom) / 2 - top0,
        });
      }
      placed.sort((a, b) => a.top - b.top);
      let floor = -Infinity;
      for (const p of placed) {
        p.top = Math.max(p.top, floor);
        floor = p.top + (heights.current.get(p.item.key) ?? 64) + STACK_GAP;
      }
      setLayout({ left, placed });
    };
    measure();
    // Anything that can move a passage - typing, widgets drawn or typed
    // in, an image loading, the window resized, the column settling after
    // it moved over - re-measures, at most once a frame.
    let frame = 0;
    const soon = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const ro = new ResizeObserver(soon);
    ro.observe(scrollEl);
    ro.observe(view.dom);
    const mo = new MutationObserver(soon);
    mo.observe(view.dom, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    contentEl.addEventListener("transitionend", soon);
    return () => {
      ro.disconnect();
      mo.disconnect();
      contentEl.removeEventListener("transitionend", soon);
      cancelAnimationFrame(frame);
    };
    // `tick`: a card's measured height changed, restack.
  }, [view, noMargin, items, scrollEl, contentEl, tick, layoutKey]);

  // Unmounting (the editor going away) gives the column its place back.
  useLayoutEffect(
    () => () => {
      contentEl.style.marginLeft = "";
      scrollEl.classList.remove("review-notes-on");
    },
    [contentEl, scrollEl],
  );

  if (!layout) return null;
  const onHeight = (key: string) => (h: number) => {
    if (heights.current.get(key) !== h) {
      heights.current.set(key, h);
      setTick((t) => t + 1);
    }
  };
  return createPortal(
    <div className="review-margin">
      <svg className="review-links" aria-hidden="true">
        {layout.placed.map((p) => {
          const x2 = layout.left;
          const y2 = p.top + 16;
          const dx = Math.max(16, (x2 - p.ax) / 2);
          return (
            <path
              key={p.item.key}
              className={`${p.item.kind}${hot === p.item.key ? " hot" : ""}`}
              d={`M${p.ax} ${p.ay} C ${p.ax + dx} ${p.ay}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
            />
          );
        })}
      </svg>
      {layout.placed.map((p) => {
        const style = { top: p.top, left: layout.left, width: CARD_WIDTH };
        const item = p.item;
        return item.kind === "note" ? (
          <NoteCard
            key={item.key}
            note={item.note}
            hot={hot === item.key}
            labels={labels}
            style={style}
            onHot={(on) => onHot(on ? item.key : null)}
            onDone={onDone}
            onAsk={onAsk}
            onHeight={onHeight(item.key)}
          />
        ) : (
          <RevisionCard
            key={item.key}
            item={item}
            hot={hot === item.key}
            focused={focused === item.key}
            labels={labels}
            style={style}
            onHot={(on) => onHot(on ? item.key : null)}
            onDecide={onDecide}
            onHeight={onHeight(item.key)}
          />
        );
      })}
    </div>,
    scrollEl,
  );
}

const CHECK = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);
const CROSS = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

/** A changed sentence in the margin: what replaces it, and ✓ / ✕ - the same
 *  decision as the AI card's. A kept one dims, its replacement struck. */
function RevisionCard({
  item,
  hot,
  focused,
  labels,
  style,
  onHot,
  onDecide,
  onHeight,
}: {
  item: Extract<MarginItem, { kind: "revision" }>;
  hot: boolean;
  focused: boolean;
  labels: ReviewMarginLabels;
  style: CSSProperties;
  onHot: (on: boolean) => void;
  onDecide: (callId: string, index: number, take: boolean | null) => void;
  onHeight: (height: number) => void;
}) {
  const ref = useCardHeight(onHeight);
  const state =
    item.take === false ? "kept" : item.take === true ? "taken" : "open";
  return (
    <div
      ref={ref}
      className={`review-note revision-note revision-note-${state}${hot ? " review-note-hot" : ""}${focused ? " revision-note-focus" : ""}`}
      style={style}
      onMouseEnter={() => onHot(true)}
      onMouseLeave={() => onHot(false)}
    >
      <div className="review-note-by">
        <span className="revision-note-num" aria-hidden="true">
          {item.num}
        </span>
        {labels.reviewBarLabel}
        <span className="agent-proposal-pick revision-note-pick">
          <button
            type="button"
            className="pending-pick-take"
            aria-pressed={item.take === true}
            aria-label={labels.proposalTakeSentence}
            title={labels.proposalTakeSentence}
            onClick={() =>
              onDecide(
                item.callId,
                item.index,
                item.take === true ? null : true,
              )
            }
          >
            {CHECK}
          </button>
          <button
            type="button"
            className="pending-pick-keep"
            aria-pressed={item.take === false}
            aria-label={labels.proposalKeepSentence}
            title={labels.proposalKeepSentence}
            onClick={() =>
              onDecide(
                item.callId,
                item.index,
                item.take === false ? null : false,
              )
            }
          >
            {CROSS}
          </button>
        </span>
      </div>
      {item.shows === "new" ? (
        <div className="revision-note-text revision-note-original">
          <span className="revision-note-was">
            {labels.proposalDeletedSentence}
          </span>
          <s>{item.before.trim() || "\u2014"}</s>
        </div>
      ) : (
        <div className="revision-note-text">
          {item.after.trim() || (
            <span className="revision-note-delete">
              {labels.proposalDeleteSentence}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function useCardHeight(onHeight?: (height: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onHeight);
  latest.current = onHeight;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => latest.current?.(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return ref;
}

function NoteCard({
  note,
  hot,
  labels,
  style,
  onHot,
  onDone,
  onAsk,
  onHeight,
}: {
  note: ReviewNote;
  hot: boolean;
  labels: ReviewMarginLabels;
  style: CSSProperties;
  onHot: (on: boolean) => void;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onHeight?: (height: number) => void;
}) {
  const ref = useCardHeight(onHeight);
  return (
    <div
      ref={ref}
      className={`review-note${hot ? " review-note-hot" : ""}`}
      style={style}
      data-note={note.id}
      onMouseEnter={() => onHot(true)}
      onMouseLeave={() => onHot(false)}
    >
      <div className="review-note-by">
        <span className="review-note-mark" aria-hidden="true">
          AI
        </span>
        {labels.reviewNoteBy}
      </div>
      <div className="review-note-text">{note.comment}</div>
      <div className="review-note-actions">
        <button type="button" onClick={() => onAsk(note)}>
          {labels.reviewNoteAsk}
        </button>
        <button type="button" onClick={() => onDone(note.id)}>
          {labels.reviewNoteDone}
        </button>
      </div>
    </div>
  );
}

/** Compact mode: a note opened from its badge, as a small floating card
 *  under it. */
export function NotePopover({
  note,
  x,
  y,
  labels,
  onDone,
  onAsk,
  onClose,
}: {
  note: ReviewNote;
  x: number;
  y: number;
  labels: ReviewMarginLabels;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Kept within the document's column: in a narrow window it reached
  // across the divider into the AI panel.
  const pos = useViewportClamp(ref, x, y, {
    right: () =>
      document
        .querySelector('[data-active-tab="true"] > .editor-scroll')
        ?.getBoundingClientRect().right,
  });
  useLayoutEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current?.contains(target) || target.closest?.(".review-badge"))
        return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      className="review-note review-note-popover floating-surface"
      style={pos}
      role="dialog"
      aria-label={labels.reviewNoteBy}
    >
      <div className="review-note-by">
        <span className="review-note-mark" aria-hidden="true">
          AI
        </span>
        {labels.reviewNoteBy}
      </div>
      <div className="review-note-text">{note.comment}</div>
      <div className="review-note-actions">
        <button type="button" onClick={() => onAsk(note)}>
          {labels.reviewNoteAsk}
        </button>
        <button type="button" onClick={() => onDone(note.id)}>
          {labels.reviewNoteDone}
        </button>
      </div>
    </div>,
    document.body,
  );
}
