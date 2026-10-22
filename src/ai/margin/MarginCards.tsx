import { RevisionNoteText } from "./RevisionNoteText";
import { InlineMarkdownText } from "../MarkdownText";
import { memo, useLayoutEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ReviewNote } from "./review-notes-plugin";
import { useViewportClamp } from "../../utils/hooks/useViewportClamp";
import { animate } from "../../ui/motion";
import { CARD_WIDTH } from "./margin-room";
import { Tooltip } from "../../ui/Tooltip";
import "./ReviewMargin.css";
import type { MarginItem, ReviewMarginLabels } from "./margin-layout";

/**
 * The margin's cards (ReviewMargin.tsx): a revision with its sentences to
 * keep or drop, a note with its question, and the note popover a phone
 * shows instead.
 */

export const CHECK = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);
export const CROSS = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

/** What a card is told by the margin: where it sits, and the margin's
 *  callbacks, which keep their identity across renders. */
export interface CardPlace {
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
export function useCardBox(
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

export type RevisionItem = Extract<MarginItem, { kind: "revision" }>;

/** A changed sentence in the margin: what replaces it, and ✓ / ✕ - the same
 *  decision as the AI card's. A kept one dims, its replacement struck. */
export const RevisionCard = memo(
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

export const NoteCard = memo(function NoteCard({
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
      <div className="review-note-text">
        <InlineMarkdownText text={note.comment} />
      </div>
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
      <div className="review-note-text">
        <InlineMarkdownText text={note.comment} />
      </div>
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
