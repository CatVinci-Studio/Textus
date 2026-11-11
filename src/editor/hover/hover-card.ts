import { scaledPx } from "../../engine/tokens/chrome-scale";
import { EDGE, clampLeft, opensBelow } from "../../engine/controls/placement";
import { currentStrings } from "../../i18n/current";
import type { HoverCard } from "../extension-points";
import { renderMarkdownHtml } from "../markdown/render-html";
import { readEscapes } from "../markdown/link-syntax";
import "./hover-card.css";
import { duration } from "../../engine/motion/motion";

/**
 * The card a plugin's hover provider gives: beside the link until the
 * pointer has left both, or pinned, moved by its title while new cards come.
 */

const GAP = 6;

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
    el.remove();
    return;
  }
  el.classList.remove("hover-card-open");
  setTimeout(() => el.remove(), duration("--dur-fast"));
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
    pin.onclick = () => el.remove();
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
      el.remove();
      if (floating?.el === el) floating = null;
      go();
    });
    head.append(open);
  }
  head.append(pin);
  const body = document.createElement("div");
  body.className = "hover-card-body milkdown";
  // Parsed inert, so no picture starts loading: a card loads nothing.
  const parsed = document.createElement("template");
  parsed.innerHTML = renderMarkdownHtml(card.markdown);
  for (const img of parsed.content.querySelectorAll("img")) img.remove();
  // Links in the card are for reading, not following from here.
  for (const a of parsed.content.querySelectorAll("a"))
    a.removeAttribute("href");
  body.append(parsed.content);
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
    handle.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    const from = { x: el.offsetLeft, y: el.offsetTop };
    const move = (m: PointerEvent) => {
      el.style.left = `${from.x + m.clientX - start.x}px`;
      el.style.top = `${from.y + m.clientY - start.y}px`;
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
}
