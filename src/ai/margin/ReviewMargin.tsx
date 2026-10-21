import { RevisionNoteText } from "./RevisionNoteText";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { ReviewNote } from "./review-notes-plugin";
import { useViewportClamp } from "../../utils/hooks/useViewportClamp";
import { useLatest } from "../../utils/hooks/useLatest";
import { flip } from "../../ui/flip";
import { animate } from "../../ui/motion";
import { CARD_WIDTH, GAP, marginRoom } from "./margin-room";
import { Tooltip } from "../../ui/Tooltip";
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
      /** Its rewrite is still streaming in: shown, not decided yet. */
      streaming: boolean;
    };

const STACK_GAP = 8;
/** How far a card can be pushed down by the ones above it and still draw
 *  its line all the time. */
const LINE_DRIFT = 20;

interface Placed {
  item: MarginItem;
  top: number;
  /** How far the cards above pushed it below its passage. */
  drift: number;
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

/** Puts the text column's left edge at `marginLeft` ("" for its own,
 *  centred) at once, and glides it there on its transform (ui/flip.ts): a
 *  margin-left transition laid the whole document out again on every
 *  frame. */
function placeColumn(contentEl: HTMLElement, marginLeft: string) {
  if (contentEl.style.marginLeft === marginLeft) return;
  flip(
    [contentEl],
    () => {
      contentEl.style.marginLeft = marginLeft;
    },
    { duration: "--dur-slow", easing: "--ease-spring" },
  );
}

type Layout = { left: number; placed: Placed[] };

/** Whether a measure found everything where it already was: the cards
 *  aren't drawn again then. A streaming rewrite re-measures on every frame
 *  it changes the text, and drew every card again each time. */
function sameLayout(a: Layout | null, b: Layout): boolean {
  return (
    a !== null &&
    a.left === b.left &&
    a.placed.length === b.placed.length &&
    a.placed.every((p, i) => {
      const q = b.placed[i];
      return (
        p.item === q.item &&
        p.top === q.top &&
        p.drift === q.drift &&
        p.ax === q.ax &&
        p.ay === q.ay
      );
    })
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
 * of its passage, cards that would overlap stack downward - the cards move,
 * never the text - and a thin line runs to the card from the text column's
 * edge, level with that first line - not from the passage's end, which
 * would cross the words after it or, when it wraps, throw the line across
 * the page. A card the stack pushed below its passage draws its line only
 * while it is under the pointer or the review bar's pointer: every such
 * line ran down the narrow gap between text and cards, and a stack of
 * them read as a tangle of stray strokes. Hovering either side lights
 * both.
 *
 * The margin is made, not assumed: when the space right of the text is too
 * narrow the text column moves left to open it (gliding there, placeColumn),
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
  const [layout, setLayout] = useState<Layout | null>(null);
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
      placeColumn(contentEl, "");
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
      placeColumn(contentEl, shift > 0 ? `${natural - shift}px` : "");
      const left = textRight - shift + GAP;
      const box = scrollEl.getBoundingClientRect();
      const top0 = box.top - scrollEl.scrollTop;
      // Horizontal positions are taken from the column, wherever its glide
      // has it right now, and placed where it is going.
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
          drift: 0,
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
        p.drift = Math.max(0, floor - p.top);
        p.top += p.drift;
        floor = p.top + (heights.current.get(p.item.key) ?? 64) + STACK_GAP;
      }
      const next = { left, placed };
      setLayout((was) => (sameLayout(was, next) ? was : next));
    };
    measure();
    // Anything that can move a passage - typing, widgets drawn or typed
    // in, an image loading, the window resized - re-measures, at most once
    // a frame.
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
    return () => {
      ro.disconnect();
      mo.disconnect();
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

  // The cards' callbacks, the same from one render to the next, so a card
  // whose own props didn't change isn't drawn again (they are memo'd).
  const actions = useLatest({ onHot, onDone, onAsk, onDecide });
  const cardHot = useCallback(
    (key: string, on: boolean) => actions.current.onHot(on ? key : null),
    [actions],
  );
  const cardDone = useCallback(
    (id: string) => actions.current.onDone(id),
    [actions],
  );
  const cardAsk = useCallback(
    (note: ReviewNote) => actions.current.onAsk(note),
    [actions],
  );
  const cardDecide = useCallback(
    (callId: string, index: number, take: boolean | null) =>
      actions.current.onDecide(callId, index, take),
    [actions],
  );
  const onHeight = useCallback((key: string, h: number) => {
    if (heights.current.get(key) !== h) {
      heights.current.set(key, h);
      setTick((t) => t + 1);
    }
  }, []);

  if (!layout) return null;
  return createPortal(
    <div className="review-margin">
      <svg className="review-links" aria-hidden="true">
        {layout.placed.map((p) => {
          const lit = hot === p.item.key || focused === p.item.key;
          if (p.drift > LINE_DRIFT && !lit) return null;
          const x2 = layout.left;
          const y2 = p.top + 16;
          const dx = Math.max(16, (x2 - p.ax) / 2);
          return (
            <path
              key={p.item.key}
              // Its length as 1, for the dash it draws in with: a fixed
              // dash length left a long line - a card stacked far below
              // its passage - broken into stray pieces.
              pathLength={1}
              className={`${p.item.kind}${lit ? " hot" : ""}`}
              d={`M${p.ax} ${p.ay} C ${p.ax + dx} ${p.ay}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
            />
          );
        })}
      </svg>
      {layout.placed.map((p) => {
        const item = p.item;
        return item.kind === "note" ? (
          <NoteCard
            key={item.key}
            itemKey={item.key}
            note={item.note}
            hot={hot === item.key}
            labels={labels}
            top={p.top}
            left={layout.left}
            onHot={cardHot}
            onDone={cardDone}
            onAsk={cardAsk}
            onHeight={onHeight}
          />
        ) : (
          <RevisionCard
            key={item.key}
            item={item}
            hot={hot === item.key}
            focused={focused === item.key}
            labels={labels}
            top={p.top}
            left={layout.left}
            onHot={cardHot}
            onDecide={cardDecide}
            onHeight={onHeight}
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

/** What a card is told by the margin: where it sits, and the margin's
 *  callbacks, which keep their identity across renders. */
interface CardPlace {
  hot: boolean;
  labels: ReviewMarginLabels;
  top: number;
  left: number;
  onHot: (key: string, on: boolean) => void;
  onHeight: (key: string, height: number) => void;
}

/**
 * A card's box: its height, reported for the stack, and the glide when
 * the stack moves it. Its place changes at once and the card slides there
 * from where it was, on `translate` - its `transform` is the hover nudge
 * and the entrance - so the margin is laid out once, not on every frame
 * of a `top` transition. Moved again mid-glide, it goes on from where it
 * shows.
 */
function useCardBox(
  key: string,
  top: number,
  onHeight: CardPlace["onHeight"],
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onHeight);
  latest.current = onHeight;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => latest.current(key, el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [key]);
  const glide = useRef<{
    top: number;
    from: number;
    animation: Animation | null;
  } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const last = glide.current;
    if (!el || !last) {
      glide.current = { top, from: 0, animation: null };
      return;
    }
    if (last.top === top) return;
    let from = last.top - top;
    const running = last.animation;
    if (running?.playState === "running") {
      const progress = running.effect?.getComputedTiming().progress ?? 1;
      from += last.from * (1 - progress);
      running.cancel();
    }
    glide.current = {
      top,
      from,
      animation: animate(
        el,
        [{ translate: `0 ${from}px` }, { translate: "0 0" }],
        { duration: "--dur-slow", easing: "--ease-spring" },
      ),
    };
  }, [top]);
  return ref;
}

type RevisionItem = Extract<MarginItem, { kind: "revision" }>;

/** A changed sentence in the margin: what replaces it, and ✓ / ✕ - the same
 *  decision as the AI card's. A kept one dims, its replacement struck. */
const RevisionCard = memo(
  function RevisionCard({
    item,
    hot,
    focused,
    labels,
    top,
    left,
    onHot,
    onDecide,
    onHeight,
  }: CardPlace & {
    item: RevisionItem;
    focused: boolean;
    onDecide: (callId: string, index: number, take: boolean | null) => void;
  }) {
    const ref = useCardBox(item.key, top, onHeight);
    const state =
      item.take === false ? "kept" : item.take === true ? "taken" : "open";
    return (
      <div
        ref={ref}
        className={`review-note revision-note revision-note-${state}${hot ? " review-note-hot" : ""}${focused ? " revision-note-focus" : ""}${item.streaming ? " revision-note-streaming" : ""}`}
        role="group"
        aria-label={`${labels.reviewBarLabel} ${item.num}`}
        style={{ top, left, width: CARD_WIDTH }}
        onMouseEnter={() => onHot(item.key, true)}
        onMouseLeave={() => onHot(item.key, false)}
      >
        <div className="review-note-by">
          <span className="revision-note-num" aria-hidden="true">
            {item.num}
          </span>
          {labels.reviewBarLabel}
          <span className="agent-proposal-pick revision-note-pick">
            <Tooltip text={labels.proposalTakeSentence}>
              <button
                type="button"
                className="pending-pick-take"
                aria-pressed={item.take === true}
                disabled={item.streaming}
                aria-label={labels.proposalTakeSentence}
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
            </Tooltip>
            <Tooltip text={labels.proposalKeepSentence}>
              <button
                type="button"
                className="pending-pick-keep"
                aria-pressed={item.take === false}
                disabled={item.streaming}
                aria-label={labels.proposalKeepSentence}
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
            </Tooltip>
          </span>
        </div>
        {item.shows === "new" ? (
          <div className="revision-note-text revision-note-original">
            <span className="revision-note-was">
              {labels.proposalDeletedSentence}
            </span>
            <s>
              {item.before.trim() ? (
                <RevisionNoteText text={item.before.trim()} />
              ) : (
                "—"
              )}
            </s>
          </div>
        ) : (
          <div className="revision-note-text">
            {/* The text shows the original; read out here too, so the
              card says what is replaced by what. */}
            {item.before.trim() && (
              <span className="visually-hidden">
                {labels.proposalDeletedSentence}:{" "}
                <del>
                  <RevisionNoteText text={item.before.trim()} />
                </del>
              </span>
            )}
            {item.after.trim() ? (
              <RevisionNoteText text={item.after.trim()} />
            ) : (
              <span className="revision-note-delete">
                {labels.proposalDeleteSentence}
              </span>
            )}
          </div>
        )}
      </div>
    );
  },
  // The items are made afresh whenever a pending edit changes, and their
  // positions in the text (from, to) move as it is typed in: what the card
  // shows is what counts.
  (a, b) =>
    a.hot === b.hot &&
    a.focused === b.focused &&
    a.labels === b.labels &&
    a.top === b.top &&
    a.left === b.left &&
    a.onHot === b.onHot &&
    a.onDecide === b.onDecide &&
    a.onHeight === b.onHeight &&
    a.item.key === b.item.key &&
    a.item.callId === b.item.callId &&
    a.item.index === b.item.index &&
    a.item.num === b.item.num &&
    a.item.after === b.item.after &&
    a.item.before === b.item.before &&
    a.item.shows === b.item.shows &&
    a.item.take === b.item.take &&
    a.item.streaming === b.item.streaming,
);

const NoteCard = memo(function NoteCard({
  itemKey,
  note,
  hot,
  labels,
  top,
  left,
  onHot,
  onDone,
  onAsk,
  onHeight,
}: CardPlace & {
  itemKey: string;
  note: ReviewNote;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
}) {
  const ref = useCardBox(itemKey, top, onHeight);
  return (
    <div
      ref={ref}
      className={`review-note${hot ? " review-note-hot" : ""}`}
      style={{ top, left, width: CARD_WIDTH }}
      data-note={note.id}
      onMouseEnter={() => onHot(itemKey, true)}
      onMouseLeave={() => onHot(itemKey, false)}
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
});

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
