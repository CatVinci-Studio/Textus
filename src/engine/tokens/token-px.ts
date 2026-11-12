import { onAppearance } from "./appearance";

/** Length tokens in px as the page resolves them now (calc, round() and
 *  the interface's scale included), kept until the appearance changes. */
const cache = new Map<string, number>();
let probe: HTMLSpanElement | null = null;
let watching = false;

/** A length custom property, `name`, in px; `fresh` reads it again (a
 *  measure that may run before the appearance's change is told). */
export function tokenPx(name: string, { fresh = false } = {}): number {
  if (typeof document === "undefined" || !document.body) return 0;
  const kept = cache.get(name);
  if (!fresh && kept !== undefined) return kept;
  if (!watching) {
    watching = true;
    onAppearance(() => cache.clear());
  }
  if (!probe) {
    probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;height:0";
  }
  if (!probe.isConnected) document.body.append(probe);
  probe.style.width = `var(${name}, 0px)`;
  const px = probe.getBoundingClientRect().width;
  cache.set(name, px);
  return px;
}
