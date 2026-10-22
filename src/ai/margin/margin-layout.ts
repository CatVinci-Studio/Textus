import { useLayoutEffect, useMemo, useState } from "react";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { ReviewNote } from "./review-notes-plugin";
import { useLatest } from "../../utils/hooks/useLatest";
import { flip } from "../../ui/flip";
import { marginRoom } from "./margin-room";
import "./ReviewMargin.css";

/**
 * Where the margin goes and its cards stand (ReviewMargin.tsx): the room
 * beside the text, the column moved aside to make it, each card level
 * with its passage and stacked clear of the one above.
 */

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

export const STACK_GAP = 8;
/** How far a card can be pushed down by the ones above it and still draw
 *  its line at full strength. */
export const LINE_DRIFT = 20;

export interface Placed {
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
export function measureRoom(
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
export function placeColumn(contentEl: HTMLElement, marginLeft: string) {
  if (contentEl.style.marginLeft === marginLeft) return;
  flip(
    [contentEl],
    () => {
      contentEl.style.marginLeft = marginLeft;
    },
    { duration: "--dur-slow", easing: "--ease-spring" },
  );
}

export type Layout = { left: number; placed: Placed[] };

/** Whether a measure found everything where it already was: the cards
 *  aren't drawn again then. A streaming rewrite re-measures on every frame
 *  it changes the text, and drew every card again each time. */
export function sameLayout(a: Layout | null, b: Layout): boolean {
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
export function anchorSelector(item: MarginItem): string {
  return item.kind === "note"
    ? `.review-anchor[data-note="${CSS.escape(item.note.id)}"]`
    : `[data-call="${CSS.escape(item.callId)}"][data-index="${item.index}"]`;
}

/** Whether the window has room for a margin beside the text, cards or no
 *  cards - reported to `onNoMargin` as it changes. */
export function useMarginRoom(
  view: EditorView | null,
  scrollEl: HTMLElement,
  contentEl: HTMLElement,
  onNoMargin: (noMargin: boolean) => void,
) {
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
  return noMargin;
}

/** The cards' callbacks, the same from one render to the next, so a card
 *  whose own props didn't change isn't drawn again (they are memo'd). */
export function useCardActions(handlers: {
  onHot: (key: string | null) => void;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onDecide: (callId: string, index: number, take: boolean | null) => void;
}) {
  const actions = useLatest(handlers);
  return useMemo(
    () => ({
      cardHot: (key: string, on: boolean) =>
        actions.current.onHot(on ? key : null),
      cardDone: (id: string) => actions.current.onDone(id),
      cardAsk: (note: ReviewNote) => actions.current.onAsk(note),
      cardDecide: (callId: string, index: number, take: boolean | null) =>
        actions.current.onDecide(callId, index, take),
    }),
    [actions],
  );
}
