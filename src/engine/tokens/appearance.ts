import { createSubscribers } from "../../utils/store";

/**
 * The one watch on the window's look: the root's attributes (theme, scale,
 * platform, layout marks) and the stylesheets in <head> - a theme applied,
 * Interface Text Size, a stylesheet loaded - and the system's light or dark.
 * Everything that reads computed tokens hears it from here, once per
 * change, instead of watching the page itself.
 */
const subscribers = createSubscribers(start);

/** Marks a style that only shows an interaction (a drag's room): changes
 *  to it are no change of look. */
const TRANSIENT = "data-transient";

/** A style in <head> for an interaction's marks, which nothing watching
 *  the look reacts to; removed by the caller when it ends. */
export function transientStyle(): HTMLStyleElement {
  const style = document.createElement("style");
  style.setAttribute(TRANSIENT, "");
  return document.head.appendChild(style);
}

const transient = (node: Node | null): boolean =>
  !!(node instanceof Element
    ? node.closest(`[${TRANSIENT}]`)
    : node?.parentElement?.closest(`[${TRANSIENT}]`));

/** On <html> while a theme switch paints (theme/restyle-hold.ts):
 *  transitions off (base.css). Itself no change of look. */
export const RESTYLING = "data-restyling";

/** On <html> while a change of look cross-fades (motion/look-fade.ts):
 *  clicks wait (base.css). Itself no change of look. */
export const LOOK_FADING = "data-look-fading";

function start(): () => void {
  const changed = subscribers.publish;
  const rootChanged = (records: MutationRecord[]) => {
    const marks = [RESTYLING, LOOK_FADING];
    if (records.some((r) => !marks.includes(r.attributeName ?? ""))) changed();
  };
  const headChanged = (records: MutationRecord[]) => {
    // Inside a transient style, or one added or removed: no change of look.
    const look = records.some(
      (r) =>
        !transient(r.target) &&
        (r.type !== "childList" ||
          [...r.addedNodes, ...r.removedNodes].some((n) => !transient(n))),
    );
    if (look) changed();
  };
  const root = new MutationObserver(rootChanged);
  root.observe(document.documentElement, { attributes: true });
  const head = new MutationObserver(headChanged);
  head.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)");
  const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  dark?.addEventListener?.("change", changed);
  motion?.addEventListener?.("change", changed);
  return () => {
    root.disconnect();
    head.disconnect();
    dark?.removeEventListener?.("change", changed);
    motion?.removeEventListener?.("change", changed);
  };
}

/** Calls `listener` whenever the window's look may have changed; returns
 *  the function that stops. The watch runs while anyone listens. */
export function onAppearance(listener: () => void): () => void {
  if (typeof MutationObserver !== "function") return () => {};
  return subscribers.subscribe(listener);
}

/** Whether the app shows its dark appearance: the explicit choice, else the
 *  system's. */
export function appearanceIsDark(): boolean {
  // A one-design imported theme shows its light page in either appearance.
  if (document.documentElement.hasAttribute("data-light-page")) return false;
  const chosen = document.documentElement.getAttribute("data-theme");
  if (chosen === "dark") return true;
  if (chosen === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/** What sets the page's theme: built-in or imported, the appearance chosen
 *  and the system's. */
const THEME_MARKS = [
  "data-theme",
  "data-theme-id",
  "data-content-theme",
  "data-user-theme",
  "data-light-page",
];

/** The page's theme now, as a key that changes when it does. */
export function themeKey(): string {
  const root = document.documentElement;
  // JSON: an attribute that is there but empty differs from none.
  return JSON.stringify([
    ...THEME_MARKS.map((name) => root.getAttribute(name)),
    window.matchMedia?.("(prefers-color-scheme: dark)").matches,
  ]);
}

let themeStyleWrites = 0;

/** Sets a theme <style>'s text, counted: a theme switch is then told
 *  without reading stylesheets that may be megabytes long. */
export function writeThemeStyle(style: HTMLStyleElement, css: string): void {
  style.textContent = css;
  themeStyleWrites++;
}

export const themeStyleVersion = (): number => themeStyleWrites;

/** Whether the window shows its dark appearance now. */
export function windowIsDark(): boolean {
  return getComputedStyle(document.documentElement).colorScheme === "dark";
}
