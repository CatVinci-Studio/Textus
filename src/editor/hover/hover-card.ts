import { currentStrings } from "../../i18n/current";
import type { HoverCard } from "../../plugins/hover-providers";
import { renderMarkdownHtml } from "../markdown/render-html";
import "./hover-card.css";
import { duration } from "../../ui/motion";

/**
 * The card a plugin's hover provider gives for what the pointer rests on
 * (link-hover-plugin.ts): beside the link, until the pointer has left both
 * - or pinned, a small window of its own inside this one, moved by its
 * title and closed by its button, while new cards come and go.
 */

const GAP = 6;
const MARGIN = 8;

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

/** The pointer is back on the link or the card: it stays. */
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

/** The card not pinned goes - at once, or fading out. */
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
  el.className = "hover-card";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", card.title ?? t.hoverCard);
  const head = document.createElement("div");
  head.className = "hover-card-head";
  const title = document.createElement("span");
  title.className = "hover-card-title";
  title.textContent = card.title ?? "";
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
  head.append(title, pin);
  const body = document.createElement("div");
  body.className = "hover-card-body milkdown";
  body.innerHTML = renderMarkdownHtml(card.markdown);
  // No pictures: their addresses are the plugin's, and a card loads
  // nothing from the network.
  for (const img of body.querySelectorAll("img")) img.remove();
  // Links in the card are for reading, not following from here.
  for (const a of body.querySelectorAll("a")) a.removeAttribute("href");
  el.append(head, body);
  return el;
}

/** Below the link, or above it when there is no room below; inside the
 *  window either way. */
function place(el: HTMLElement, rect: DOMRect) {
  const { innerWidth: w, innerHeight: h } = window;
  const box = el.getBoundingClientRect();
  const below = rect.bottom + GAP;
  const top =
    below + box.height <= h - MARGIN || rect.top - GAP - box.height < MARGIN
      ? Math.min(below, h - MARGIN - box.height)
      : rect.top - GAP - box.height;
  const left = Math.min(Math.max(MARGIN, rect.left), w - MARGIN - box.width);
  el.style.top = `${Math.max(MARGIN, top)}px`;
  el.style.left = `${Math.max(MARGIN, left)}px`;
}

/** A pinned card moves by its title row. */
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
