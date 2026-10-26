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

/** The page's margin: review notes and a pending rewrite's changes, each card
 *  level with its passage and linked to it. The text column moves left to
 *  make room; with none, `onNoMargin` hands everything back to the text. */
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
  onEdit,
  onDecide,
  onNoMargin,
  layoutKey,
  picked = null,
  onPick,
  onOpen,
}: {
  /** A click on a card selects it; it comes back as `focused`. */
  onOpen?: (key: string | null) => void;
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
  /** The item selected - clicked, or pointed at by the review bar or the
   *  notes bar ("rev:<callId>:<index>", or "note:<id>"): its card opens. */
  focused: string | null;
  scrollEl: HTMLElement;
  contentEl: HTMLElement;
  labels: ReviewMarginLabels;
  onHot: (key: string | null) => void;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onEdit: (note: ReviewNote) => void;
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
        const at = item.kind === "note" ? item.note.from : item.from;
        placed.push({
          item,
          top: first.top - top0 - 8,
          drift: 0,
          cut: null,
          chip: false,
          group: null,
          block: view.state.doc
            .resolve(Math.min(at, view.state.doc.content.size))
            .index(0),
          // From the column's edge, never inside the text, where it would
          // cross the words after the passage.
          ax: textEdge + 6,
          ay: (first.top + first.bottom) / 2 - top0,
        });
      }
      stackCards(placed, (key) => heights.current.get(key) ?? 64);
      const next = { left, placed };
      setLayout((was) => (sameLayout(was, next) ? was : next));
    };
    measure();
    // Anything that can move a passage re-measures, at most once a frame.
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

  const {
    cardHot,
    cardDone,
    cardAsk,
    cardEdit,
    cardDecide,
    cardPick,
    cardOpen,
  } = useCardActions({
    onHot,
    onDone,
    onAsk,
    onEdit,
    onDecide,
    onPick: onPick ?? (() => {}),
    onOpen: onOpen ?? (() => {}),
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
          // A group draws one line, from its first passage.
          if (p.group !== null && p.group !== p.item.key) return null;
          const own = (key: string | null) =>
            p.group === null
              ? key === p.item.key
              : layout.placed.some(
                  (q) => q.group === p.group && q.item.key === key,
                );
          const lit = own(hot) || own(focused);
          // Far below its passage, a card's line is fainter, not gone.
          const far = p.drift > LINE_DRIFT;
          const x2 = layout.left;
          const y2 = p.top + (p.chip ? CHIP_HEIGHT / 2 : 16);
          const dx = Math.max(16, (x2 - p.ax) / 2);
          return (
            <path
              key={p.item.key}
              // Length 1 for the draw-in dash, so long lines don't break up.
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
                picked !== null || members.some((q) => q.item.key === focused)
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
              onEdit={cardEdit}
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
            open={focused === item.key}
            onOpen={cardOpen}
            labels={labels}
            top={p.top}
            left={layout.left}
            onHot={cardHot}
            onDone={cardDone}
            onAsk={cardAsk}
            onEdit={cardEdit}
            onHeight={onHeight}
          />
        ) : (
          <RevisionCard
            key={item.key}
            item={item}
            hot={hot === item.key}
            focused={focused === item.key}
            open={focused === item.key}
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
