import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { ReviewNote } from "./review-notes-plugin";
import { useLatest } from "../../utils/hooks/useLatest";
import { flip } from "../../ui/flip";
import { marginRoom } from "./margin-room";
import "./ReviewMargin.css";
import { zoomedRectScale } from "../../ui/zoomed-rects";
import { noteAnchorClass } from "./review-notes-plugin";

/** Where the margin goes and its cards stand, each level with its passage
 *  and stacked clear of the one above. */

export interface ReviewMarginLabels {
  reviewNoteBy: string;
  /** "{n} notes": a run of them as one chip. */
  reviewGroupNotes: string;
  /** A note's box while picking on the notes bar. */
  reviewNotesPickOne: string;
  /** "{n} changes", likewise. */
  proposalChangeCount: string;
  reviewNoteAsk: string;
  reviewNoteDone: string;
  /** An own note's mark, by-line and actions. */
  ownNoteMark: string;
  ownNoteBy: string;
  ownNoteEdit: string;
  ownNoteDelete: string;
  reviewBarLabel: string;
  proposalTakeSentence: string;
  proposalKeepSentence: string;
  proposalDeleteSentence: string;
  proposalDeletedSentence: string;
  /** A card's heading for a sentence a rewrite adds, with no original. */
  proposalAddedSentence: string;
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
      /** Which side stays in the text: "original" (the card shows the
       *  replacement) or "new" (the card shows what it replaces). */
      shows: "original" | "new";
      take: boolean | null;
      /** Its rewrite is still streaming in: shown, not decided yet. */
      streaming: boolean;
    };

export const STACK_GAP = 8;
/** How far a card can be pushed down by the ones above it and still draw
 *  its line at full strength. */
export const LINE_DRIFT = 20;
/** A chip's height: the card's heading and one line of its text. Keep in
 *  step with .review-note-chip. */
export const CHIP_HEIGHT = 35;
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
  /** The height it is cut to beside its passage, or null for the whole
   *  card. */
  cut: number | null;
  /** Cut to one line: a chip. */
  chip: boolean;
  /** The key of the run's first card when the run shows as one chip, all
   *  its cards at the group's place; else null. */
  group: string | null;
  /** The top-level block its passage is in: a group is a paragraph's. */
  block?: number;
  /** Where the line starts: the end of the passage's first line, in the
   *  layer's coordinates. */
  ax: number;
  ay: number;
}

/** marginRoom for this editor as it is laid out now, every width as drawn:
 *  the text is inside the document's zoom, and a width from before the
 *  zoom put a zoomed page's cards over its text. */
export function measureRoom(
  scrollEl: HTMLElement,
  contentEl: HTMLElement,
  view: EditorView,
) {
  const pm = view.dom as HTMLElement;
  const column = contentEl.getBoundingClientRect().width;
  const text = pm.getBoundingClientRect().width * zoomedRectScale(pm);
  return marginRoom(scrollEl.clientWidth, column, column - text);
}

/** Sets the column's left edge to `marginLeft` ("" for centred) at once and
 *  glides it there on its transform, as a margin-left transition would lay
 *  the document out on every frame. */
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

/** Stacks the cards downward, each level with its passage or below the one
 *  above. A crowded run is cut to the room beside each passage, and where even
 *  chips drift too far, each paragraph's cards become one chip. */
export function stackCards(
  placed: Placed[],
  heightOf: (key: string) => number,
): void {
  placed.sort((a, b) => a.top - b.top);
  const want = placed.map((p) => p.top);
  let floor = -Infinity;
  // One run from `start` of cards that push each other; `end` keeps the same
  // cards when cut, so a crowded paragraph doesn't end on one whole card.
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
      let below = floor;
      for (let from = start; from < run.end;) {
        let to = from + 1;
        while (to < run.end && placed[to].block === placed[from].block) to++;
        const top = Math.max(want[from], below);
        const key = to - from > 1 ? placed[from].item.key : null;
        for (let i = from; i < to; i++)
          Object.assign(placed[i], {
            top,
            drift: Math.max(0, top - want[i]),
            cut: CHIP_HEIGHT,
            chip: true,
            group: key,
          });
        below = top + CHIP_HEIGHT + STACK_GAP;
        from = to;
      }
      run = { end: run.end, below };
    }
    floor = run.below;
    start = run.end;
  }
}

export type Layout = { left: number; placed: Placed[] };

/** Whether a measure found everything where it already was, so the cards
 *  aren't drawn again on every streaming frame. */
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
    ? `.${noteAnchorClass(item.note.id)}`
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

/** The card a click selected, until a click elsewhere or Escape. Not opened
 *  on hover, or a cut card would cover the cards the pointer goes on to. */
export function useOpenedCard<T>() {
  const [opened, setOpened] = useState<T | null>(null);
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
 *  whose own props didn't change isn't drawn again (they are memo'd). */
export function useCardActions(handlers: {
  onHot: (key: string | null) => void;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onEdit: (note: ReviewNote) => void;
  onDecide: (callId: string, index: number, take: boolean | null) => void;
  onPick: (id: string) => void;
  onOpen: (key: string | null) => void;
}) {
  const actions = useLatest(handlers);
  return useMemo(
    () => ({
      cardHot: (key: string, on: boolean) =>
        actions.current.onHot(on ? key : null),
      cardDone: (id: string) => actions.current.onDone(id),
      cardAsk: (note: ReviewNote) => actions.current.onAsk(note),
      cardEdit: (note: ReviewNote) => actions.current.onEdit(note),
      cardDecide: (callId: string, index: number, take: boolean | null) =>
        actions.current.onDecide(callId, index, take),
      cardPick: (id: string) => actions.current.onPick(id),
      cardOpen: (key: string | null) => actions.current.onOpen(key),
    }),
    [actions],
  );
}
