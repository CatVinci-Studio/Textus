/**
 * Says a short status to a screen reader without moving the focus: Textus
 * AI starting and finishing, a rewrite's changes arriving, a change
 * accepted or rejected. One polite live region for the whole window,
 * made on first use and visually hidden.
 *
 * What is announced within a moment of the last message joins it, in
 * order, so "Textus AI is done" and "3 changes proposed" don't cut each
 * other off. After that the region starts over, emptied first: the same
 * words twice in a row are still read twice.
 */

/** How long a message stays to be joined by the next. */
const JOIN_MS = 1000;

let region: HTMLElement | null = null;
let messages: string[] = [];
let lastAt = -Infinity;
let frame = 0;

function liveRegion(): HTMLElement {
  if (region?.isConnected) return region;
  region = document.createElement("div");
  region.className = "visually-hidden";
  region.setAttribute("role", "status");
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  document.body.appendChild(region);
  return region;
}

export function announce(message: string): void {
  if (typeof document === "undefined" || !message) return;
  const el = liveRegion();
  const now = performance.now();
  if (now - lastAt > JOIN_MS) {
    messages = [];
    el.textContent = "";
  }
  lastAt = now;
  messages.push(message);
  cancelAnimationFrame(frame);
  // A frame later: a region emptied and filled in one go isn't heard.
  frame = requestAnimationFrame(() => {
    el.textContent = messages.join(" ");
  });
}
