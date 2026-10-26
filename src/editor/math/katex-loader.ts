import { useEffect, useState } from "react";
import { lazyModule } from "../../lazy/lazy-module";
import { escapeHtml } from "../../utils/html";

/**
 * KaTeX is loaded the first time a formula is drawn: most documents have
 * none, and it was a large part of the startup bundle. `katexNow()` starts
 * the load and is null until done; renderers redraw on `onKatexReady`.
 */
type Katex = typeof import("katex").default;

let katex: Katex | null = null;
let firstLoad: Promise<void> | null = null;
const listeners = new Set<() => void>();

// A failed load is tried again by the next formula drawn.
const katexModule = lazyModule("katex", () =>
  import("./katex-bundle").then((module) => {
    katex = module.default;
    for (const listener of listeners) listener();
    listeners.clear();
    return katex;
  }),
);

export function loadKatex(): Promise<Katex> {
  return katexModule.load();
}

/** KaTeX if it is loaded; otherwise starts loading it and returns null. */
export function katexNow(): Katex | null {
  if (!katex) void loadKatex().catch(() => {});
  return katex;
}

/** Calls `listener` once KaTeX has loaded; returns the unsubscribe. */
export function onKatexReady(listener: () => void): () => void {
  if (katex) return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The first load, settled either way, so a caller can open without KaTeX
 *  if it fails. The same promise every time, for React's `use`. */
export function katexFirstLoad(): Promise<void> {
  firstLoad ??= loadKatex().then(
    () => {},
    () => {},
  );
  return firstLoad;
}

export function katexLoaded(): boolean {
  return katex !== null;
}

// `$`, `\(` or `\[`. A price's "$" says yes too, which only loads KaTeX
// early.
const MATH_HINT = /\$|\\\(|\\\[/;

/** Whether `markdown` may have a formula, for loading KaTeX before it is
 *  drawn. */
export function mayHaveMath(markdown: string): boolean {
  return MATH_HINT.test(markdown);
}

/** True once KaTeX has loaded: a memo key that re-renders then. */
export function useKatexReady(): boolean {
  const [ready, setReady] = useState(katex !== null);
  useEffect(() => {
    if (ready) return;
    // Loaded between the render and this effect: no event will come.
    if (katex) {
      setReady(true);
      return;
    }
    return onKatexReady(() => setReady(true));
  }, [ready]);
  return ready;
}

/** A formula's source, shown until KaTeX draws it. */
export function mathSourceHtml(source: string): string {
  return `<code class="math-pending">${escapeHtml(source)}</code>`;
}
