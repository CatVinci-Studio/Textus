import { trackDrag } from "../../engine/drag/pointer-drag";
import { scaledPx } from "../../engine/tokens/chrome-scale";
import { EDGE, clampLeft, opensBelow } from "../../engine/controls/placement";
import { currentStrings } from "../../i18n/current";
import type { HoverCard } from "../extension-points";
import { drawPreview, type PreviewHandle } from "../preview-editor";
import { PICTURES_IN_TEXT } from "../markdown/doc-blocks";
import { readEscapes } from "../markdown/link-syntax";
import "./hover-card.css";
import { duration } from "../../engine/motion/motion";

/**
 * The card a plugin's hover provider gives: beside the link until the
 * pointer has left both, or pinned, moved by its title while new cards come.
 */

const GAP = 6;

const previews = new WeakMap<HTMLElement, PreviewHandle>();

/** A card gone, the editor drawing it let go. */
function removeCard(el: HTMLElement) {
  previews.get(el)?.destroy();
  previews.delete(el);
  el.remove();
}

/** The card on screen and not pinned, if any. */
let floating: { el: HTMLElement; key: string } | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function floatingCardKey(): string | null {
  return floating?.key ?? null;
}

/** Shows `card` for `key` by `rect`, in place of any card not pinned. */
export function showHoverCard(key: string, rect: DOMRect, card: HoverCard) {
  hideHoverCard(true);
  const el = build(card);
  document.body.append(el);
  place(el, rect);
  el.addEventListener("mouseenter", keepHoverCard);
  el.addEventListener("mouseleave", () => scheduleHide());
  floating = { el, key };
  requestAnimationFrame(() => el.classList.add("hover-card-open"));
}

export function keepHoverCard() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
}

/** It goes a moment after the pointer leaves, so the pointer can cross
 *  from the link to the card. */
export function scheduleHide(ms = 250) {
  keepHoverCard();
  if (floating) hideTimer = setTimeout(() => hideHoverCard(), ms);
}

export function hideHoverCard(now = false) {
  keepHoverCard();
  const el = floating?.el;
  floating = null;
  if (!el) return;
  if (now) {
    removeCard(el);
    return;
  }
  el.classList.remove("hover-card-open");
  setTimeout(() => removeCard(el), duration("--dur-fast"));
}

function build(card: HoverCard): HTMLElement {
  const t = currentStrings();
  const el = document.createElement("div");
  el.className = "hover-card floating-surface";
  el.setAttribute("role", "dialog");
  // A title made from a link's path reads `%20` as a space.
  const named = card.title ? readEscapes(card.title) : null;
  el.setAttribute("aria-label", named ?? t.hoverCard);
  const head = document.createElement("div");
  head.className = "hover-card-head";
  const title = document.createElement("span");
  title.className = "hover-card-title";
  title.textContent = named ?? "";
  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = "hover-card-button";
  pin.textContent = t.hoverPin;
  pin.addEventListener("click", () => {
    if (floating?.el === el) {
      floating = null;
      keepHoverCard();
    }
    el.classList.add("hover-card-pinned");
    pin.textContent = t.hoverClose;
    pin.onclick = () => removeCard(el);
    movable(el, head);
  });
  head.append(title);
  if (card.open) {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "hover-card-button";
    open.textContent = t.hoverOpen;
    const go = card.open;
    open.addEventListener("click", () => {
      removeCard(el);
      if (floating?.el === el) floating = null;
      go();
    });
    head.append(open);
  }
  head.append(pin);
  const body = document.createElement("div");
  body.className = "hover-card-body";
  // Drawn by the editor, as the note shows; without pictures, so a card
  // loads nothing.
  void drawPreview(
    body,
    card.markdown.replace(PICTURES_IN_TEXT, ""),
    null,
    () => named ?? t.hoverCard,
  ).then((preview) => {
    if (el.isConnected) previews.set(el, preview);
    else preview.destroy();
  });
  el.append(head, body);
  return el;
}

/** Below the link, or above it when there is no room; inside the window. */
function place(el: HTMLElement, rect: DOMRect) {
  const box = el.getBoundingClientRect();
  const gap = scaledPx(GAP);
  const edge = scaledPx(EDGE);
  const top = opensBelow(rect, box.height, gap)
    ? Math.min(rect.bottom + gap, window.innerHeight - edge - box.height)
    : rect.top - gap - box.height;
  el.style.top = `${Math.max(edge, top)}px`;
  el.style.left = `${clampLeft(rect.left, box.width)}px`;
}

function movable(el: HTMLElement, handle: HTMLElement) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target as Element).closest("button")) return;
    e.preventDefault();
    const from = { x: el.offsetLeft, y: el.offsetTop };
    const place = (x: number, y: number) => {
      el.style.left = `${from.x + x - e.clientX}px`;
      el.style.top = `${from.y + y - e.clientY}px`;
    };
    // Moved from the first step; Esc puts it back.
    trackDrag(
      e,
      {
        move: place,
        end: (x, y, dropped) =>
          dropped ? place(x, y) : place(e.clientX, e.clientY),
      },
      { started: true },
    );
  });
}
