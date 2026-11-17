// Unit tests render in any language straight away: every language's strings
// are loaded before they run.
import { LANGS, loadLocale } from "./i18n/strings";

await Promise.all(LANGS.map(loadLocale));

// Popups keep themselves in the window by watching their size; jsdom has no
// ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// The editor measures where its caret is; jsdom lays nothing out.
if (typeof Range !== "undefined") {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
}
