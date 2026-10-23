import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { ReviewNote } from "./review-notes-plugin";
import { GAP } from "./margin-room";
import "./ReviewMargin.css";
import {
  CHIP_HEIGHT,
  LINE_DRIFT,
  type Layout,
  type MarginItem,
  type Placed,
  type ReviewMarginLabels,
  anchorSelector,
  measureRoom,
  placeColumn,
  sameLayout,
  stackCards,
  useCardActions,
  useMarginRoom,
} from "./margin-layout";
import { NoteCard, RevisionCard } from "./MarginCards";
import { MarginGroup } from "./MarginGroup";
export { type ReviewMarginLabels, type MarginItem } from "./margin-layout";
export { NotePopover } from "./MarginCards";

/**
 * The page's margin: review notes and the changed sentences of a pending
 * rewrite, beside the text they are about (review-notes-plugin.ts and
 * pending-edit-plugin.ts mark it). Each card sits level with the first line
 * of its passage, cards that would overlap stack downward - the cards move,
 * never the text - and a thin line runs to the card from the text column's
 * edge, level with that first line - not from the passage's end, which
 * would cross the words after it or, when it wraps, throw the line across
 * the page. A card the stack pushed far below its passage draws its line
 * fainter, at full strength while it is under the pointer or the review
 * bar's pointer: such lines run down the narrow gap between text and cards,
 * and a stack of them at full strength read as a tangle - but with none (as
 * in rc.6 before), the card read as belonging to nothing. Hovering either
 * side lights both.
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
  picked = null,
  onPick,
}: {
  /** The notes picked on the notes bar, or null while not picking: each
   *  note's card then has its box, and a click on it picks it. */
  picked?: ReadonlySet<string> | null;
  onPick?: (id: string) => void;
  /** Anything else that moves text without moving the items: a change
   *  re-measures. */
  layoutKey?: unknown;
  view: EditorView | null;
  items: MarginItem[];
  hot: string | null;
  /** The item the review bar points at ("rev:<callId>:<index>", or
   *  "note:<id>"). */
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
  const noMargin = useMarginRoom(view, scrollEl, contentEl, onNoMargin);

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
          cut: null,
          chip: false,
          group: null,
          // From the column's edge, level with the passage's first line -
          // never from inside the text, where it would cross the words
          // after the passage.
          ax: textEdge + 6,
          ay: (first.top + first.bottom) / 2 - top0,
        });
      }
      stackCards(placed, (key) => heights.current.get(key) ?? 64);
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

  const { cardHot, cardDone, cardAsk, cardDecide, cardPick, cardOpen, opened } =
    useCardActions({
      onHot,
      onDone,
      onAsk,
      onDecide,
      onPick: onPick ?? (() => {}),
    });
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
          // Pushed far below its passage, a card's line is fainter, not
          // gone: with none, the card read as belonging to nothing.
          const far = p.drift > LINE_DRIFT;
          const x2 = layout.left;
          const y2 = p.top + (p.chip ? CHIP_HEIGHT / 2 : 16);
          const dx = Math.max(16, (x2 - p.ax) / 2);
          return (
            <path
              key={p.item.key}
              // Its length as 1, for the dash it draws in with: a fixed
              // dash length left a long line - a card stacked far below
              // its passage - broken into stray pieces.
              pathLength={1}
              className={`${p.item.kind}${lit ? " hot" : far ? " far" : ""}`}
              d={`M${p.ax} ${p.ay} C ${p.ax + dx} ${p.ay}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
            />
          );
        })}
      </svg>
      {layout.placed.map((p) => {
        const item = p.item;
        if (p.group !== null) {
          if (p.group !== item.key) return null;
          const members = layout.placed.filter((q) => q.group === p.group);
          return (
            <MarginGroup
              key={item.key}
              groupKey={p.group}
              items={members.map((q) => q.item)}
              open={
                opened === p.group ||
                picked !== null ||
                members.some((q) => q.item.key === focused)
              }
              onOpen={cardOpen}
              picked={picked}
              onPick={cardPick}
              hot={hot}
              focused={focused}
              labels={labels}
              top={p.top}
              left={layout.left}
              onHot={cardHot}
              onDone={cardDone}
              onAsk={cardAsk}
              onDecide={cardDecide}
            />
          );
        }
        return item.kind === "note" ? (
          <NoteCard
            key={item.key}
            itemKey={item.key}
            note={item.note}
            hot={hot === item.key}
            picked={picked ? picked.has(item.note.id) : null}
            onPick={cardPick}
            cut={p.cut}
            chip={p.chip}
            open={opened === item.key || focused === item.key}
            onOpen={cardOpen}
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
            open={opened === item.key || focused === item.key}
            onOpen={cardOpen}
            cut={p.cut}
            chip={p.chip}
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
