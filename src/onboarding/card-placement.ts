import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Places a lesson card so it never hides what the lesson is about, folding
 * it to its header where it hides least when no corner is clear.
 */

export type CardPlace =
  "top-right" | "bottom-right" | "top-left" | "bottom-left" | "top" | "bottom";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What a card must stay off, by the elements that show it. */
export const CARD_OBSTACLES = [
  ".pending-insert",
  ".pending-edit",
  ".pending-delete",
  ".pending-sentence-new",
  ".review-bar",
  ".review-note",
  ".grammar-issue",
  ".grammar-popover",
  ".ghost-text",
  ".agent-panel",
].join(", ");

export function placedBox(
  place: CardPlace,
  width: number,
  height: number,
  area: Box,
): Box {
  const left =
    place === "top-left" || place === "bottom-left"
      ? area.left
      : place === "top" || place === "bottom"
        ? area.left
        : area.right - width;
  const top = place.startsWith("top") ? area.top : area.bottom - height;
  return { left, top, right: left + width, bottom: top + height };
}

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The place for a card: `current` if clear, else the first clear one of
 *  `places`; with none clear (`fits` false), the one covering least. */
export function choosePlace(
  places: CardPlace[],
  current: CardPlace,
  size: { width: number; height: number },
  area: Box,
  obstacles: Box[],
): { place: CardPlace; fits: boolean } {
  const covered = (place: CardPlace) => {
    const box = placedBox(place, size.width, size.height, area);
    return obstacles.reduce((sum, o) => sum + overlap(box, o), 0);
  };
  const order = places.includes(current)
    ? [current, ...places.filter((p) => p !== current)]
    : places;
  const clear = order.find((place) => covered(place) === 0);
  if (clear) return { place: clear, fits: true };
  const least = order.reduce((best, place) =>
    covered(place) < covered(best) ? place : best,
  );
  return { place: least, fits: false };
}

function boxOf(rect: DOMRect): Box {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

/** The obstacles on screen now, the caret's line among them. */
function visibleObstacles(card: HTMLElement): Box[] {
  const boxes: Box[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(CARD_OBSTACLES)) {
    if (card.contains(el)) continue;
    for (const rect of el.getClientRects())
      if (rect.width > 0 && rect.height > 0) boxes.push(boxOf(rect));
  }
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const host = range.startContainer.parentElement;
    if (host?.closest('[data-active-tab="true"] .ProseMirror')) {
      const rect = range.getBoundingClientRect();
      const line = rect.height > 0 ? rect : host.getBoundingClientRect();
      if (line.height > 0)
        boxes.push({
          ...boxOf(line),
          right: Math.max(line.right, line.left + 240),
        });
    }
  }
  return boxes;
}

/** Keeps a lesson card clear of what the lesson is about, as the page
 *  changes. `active` off leaves it where its stylesheet puts it. */
export function useCardPlacement(
  cardRef: RefObject<HTMLElement | null>,
  active: boolean,
  phone: boolean,
  /** The lesson: a new one is measured afresh. */
  lesson: string,
): {
  place: CardPlace | null;
  style: Partial<Record<"top" | "bottom" | "left" | "right", string>>;
  roomy: boolean;
} {
  const [state, setState] = useState<{
    place: CardPlace;
    roomy: boolean;
    box: Box;
  } | null>(null);

  // Kept from lesson to lesson, so the card only moves when it has to.
  const placeRef = useRef<CardPlace | null>(null);

  useEffect(() => {
    if (!active) {
      setState(null);
      return;
    }
    // The card's full height, kept while it is folded, to know when it
    // fits again.
    let fullHeight = 0;
    let frame = 0;
    let last: { place: CardPlace; roomy: boolean; box: Box } | null = null;
    const measure = () => {
      frame = 0;
      const card = cardRef.current;
      if (!card) return;
      // Never out from under the pointer or the keyboard: a button the
      // learner is about to press must stay where it is.
      if (card.matches(":hover, :focus-within")) return;
      const css = getComputedStyle(card);
      const docked =
        parseFloat(css.getPropertyValue("--docked-panel-width")) || 0;
      const bar = parseFloat(css.getPropertyValue("--mobile-bar")) || 0;
      const narrow = window.innerWidth <= 720;
      const gap = narrow ? 12 : 18;
      const area: Box = {
        left: gap,
        top: narrow ? bar + gap : 48,
        right: window.innerWidth - gap - (narrow ? 0 : docked),
        bottom: window.innerHeight - gap,
      };
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      if (!last || last.roomy) fullHeight = height;
      const places: CardPlace[] =
        narrow || phone
          ? ["bottom", "top"]
          : ["top-right", "bottom-right", "top-left", "bottom-left"];
      const obstacles = visibleObstacles(card);
      const current = last?.place ?? placeRef.current ?? places[0];
      const full = choosePlace(
        places,
        current,
        { width, height: fullHeight || height },
        area,
        obstacles,
      );
      const next = full.fits
        ? { place: full.place, roomy: true }
        : {
            place: choosePlace(
              places,
              current,
              { width, height },
              area,
              obstacles,
            ).place,
            roomy: false,
          };
      const box = placedBox(next.place, width, height, area);
      if (
        last &&
        last.place === next.place &&
        last.roomy === next.roomy &&
        last.box.left === box.left &&
        last.box.top === box.top &&
        last.box.bottom === box.bottom
      )
        return;
      last = { ...next, box };
      placeRef.current = next.place;
      setState(last);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
      characterData: true,
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    document.addEventListener("selectionchange", schedule);
    const leave = cardRef.current;
    leave?.addEventListener("pointerleave", schedule);
    leave?.addEventListener("focusout", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("selectionchange", schedule);
      leave?.removeEventListener("pointerleave", schedule);
      leave?.removeEventListener("focusout", schedule);
    };
  }, [active, phone, lesson, cardRef]);

  if (!state) return { place: null, style: {}, roomy: true };
  const { place } = state;
  const style: Partial<Record<"top" | "bottom" | "left" | "right", string>> =
    {};
  if (place.startsWith("top")) {
    style.top = `${state.box.top}px`;
    style.bottom = "auto";
  } else {
    style.top = "auto";
    style.bottom = `${window.innerHeight - state.box.bottom}px`;
  }
  if (place !== "top" && place !== "bottom") {
    if (place.endsWith("left")) {
      style.left = `${state.box.left}px`;
      style.right = "auto";
    } else {
      style.left = "auto";
      style.right = `${window.innerWidth - state.box.right}px`;
    }
  }
  return { place, style, roomy: state.roomy };
}
