/** Says a short status to a screen reader without moving focus. Messages
 *  within a moment of each other join so they don't cut each other off; after
 *  that the region empties first, so repeats are still read. */

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
