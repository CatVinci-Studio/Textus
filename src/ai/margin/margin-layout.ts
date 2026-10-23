import { useEffect, useLayoutEffect, useMemo, useState } from "react";
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
  /** "{n} notes": a run of them as one chip (MarginGroup). */
  reviewGroupNotes: string;
  /** A note's box while picking on the notes bar. */
  reviewNotesPickOne: string;
  /** "{n} changes", likewise. */
  proposalChangeCount: string;
  reviewNoteAsk: string;
  reviewNoteDone: string;
  reviewBarLabel: string;
  proposalTakeSentence: string;
  proposalKeepSentence: string;
  proposalDeleteSentence: string;
  proposalDeletedSentence: string;
  // What a change of a whole block (a table, a code block) is called on
  // its card - a picture is shown.
  proposalBlockPicture: string;
  proposalBlockTable: string;
  proposalBlockCode: string;
  proposalBlockMath: string;
  proposalBlockOther: string;
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
/** A chip's height (.review-note-chip): one line of the card. */
export const CHIP_HEIGHT = 30;
/** The least room a cut card is given - its heading and a line; with less,
 *  it is a chip. */
export const MIN_CUT = 88;
/** How far a run of cards may push one of its own below its passage
 *  before the whole run is cut to fit beside its passages. */
export const CROWDED_DRIFT = 120;
/** How far a run cut to fit may still push one below its passage - more
 *  notes than lines - before the run is one chip, "8 notes". */
export const GROUP_DRIFT = 200;

export interface Placed {
  item: MarginItem;
  top: number;
  /** How far the cards above pushed it below its passage. */
  drift: number;
  /** The height it is cut to beside its passage (stackCards), or null
   *  for the whole card. */
  cut: number | null;
  /** Cut to one line: a chip. */
  chip: boolean;
  /** The key of the run's first card when the run shows as one chip (a
   *  group, MarginGroup), all its cards at the group's place; else null. */
  group: string | null;
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

/**
 * Stacks the cards downward, each level with its passage (`top`) or just
 * below the one above. A run of cards that push each other - many notes,
 * or many changed sentences, in one paragraph - drifted ever further from
 * their passages as whole cards, down beside other paragraphs and past the
 * text's end. In such a run each card is cut to the room beside its own
 * passage, down to where the next one's starts: a paragraph's rewrite keeps
 * about its paragraph's height, notes on adjacent lines a line each (a
 * chip). A cut card opens whole over the ones below (ReviewMargin), so
 * opening one moves nothing. Where even chips run far below their lines -
 * more notes than the paragraph has lines - the run is one chip, which
 * opens to a list of them. `heightOf` is a card's whole height.
 */
export function stackCards(
  placed: Placed[],
  heightOf: (key: string) => number,
): void {
  placed.sort((a, b) => a.top - b.top);
  const want = placed.map((p) => p.top);
  let floor = -Infinity;
  // One run from `start`: the cards that push each other whole - cut, the
  // same cards (`end`), so a crowded paragraph doesn't end on one whole
  // card. Where it ends, and the floor under it.
  const lay = (start: number, end?: number) => {
    let below = floor;
    let i = start;
    do {
      const p = placed[i];
      p.top = Math.max(want[i], below);
      p.drift = p.top - want[i];
      const whole = heightOf(p.item.key);
      const next = end === undefined || i + 1 >= end ? Infinity : want[i + 1];
      const room = next - p.top - STACK_GAP;
      const height =
        room >= whole ? whole : room < MIN_CUT ? CHIP_HEIGHT : room;
      p.cut = height < whole ? height : null;
      p.chip = p.cut === CHIP_HEIGHT;
      p.group = null;
      below = p.top + height + STACK_GAP;
      i++;
    } while (
      i < placed.length &&
      (end === undefined ? want[i] < below : i < end)
    );
    return { end: i, below };
  };
  let start = 0;
  while (start < placed.length) {
    let run = lay(start);
    const most = () =>
      Math.max(...placed.slice(start, run.end).map((p) => p.drift));
    if (most() > CROWDED_DRIFT) run = lay(start, run.end);
    if (most() > GROUP_DRIFT) {
      const top = Math.max(want[start], floor);
      const key = placed[start].item.key;
      for (let i = start; i < run.end; i++)
        Object.assign(placed[i], {
          top,
          drift: Math.max(0, top - want[i]),
          cut: CHIP_HEIGHT,
          chip: true,
          group: key,
        });
      run = { end: run.end, below: top + CHIP_HEIGHT + STACK_GAP };
    }
    floor = run.below;
    start = run.end;
  }
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
        p.cut === q.cut &&
        p.group === q.group &&
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

/**
 * The cut card opened by a click (stackCards), whole over the ones below,
 * until a click elsewhere or Escape. Opened by the pointer passing over it,
 * it covered the very cards the pointer went on to, and they could not be
 * reached.
 */
export function useOpenedCard() {
  const [opened, setOpened] = useState<string | null>(null);
  useEffect(() => {
    if (opened === null) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(".review-note")) setOpened(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpened(null);
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc);
    };
  }, [opened]);
  return [opened, setOpened] as const;
}

/** The cards' callbacks, the same from one render to the next, so a card
 *  whose own props didn't change isn't drawn again (they are memo'd) -
 *  and the card a click opened (useOpenedCard). */
export function useCardActions(handlers: {
  onHot: (key: string | null) => void;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onDecide: (callId: string, index: number, take: boolean | null) => void;
  onPick: (id: string) => void;
}) {
  const actions = useLatest(handlers);
  const [opened, setOpened] = useOpenedCard();
  const callbacks = useMemo(
    () => ({
      cardHot: (key: string, on: boolean) =>
        actions.current.onHot(on ? key : null),
      cardDone: (id: string) => actions.current.onDone(id),
      cardAsk: (note: ReviewNote) => actions.current.onAsk(note),
      cardDecide: (callId: string, index: number, take: boolean | null) =>
        actions.current.onDecide(callId, index, take),
      cardPick: (id: string) => actions.current.onPick(id),
      cardOpen: setOpened,
    }),
    [actions, setOpened],
  );
  return { ...callbacks, opened };
}
