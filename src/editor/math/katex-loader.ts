import { useEffect, useState } from "react";
import { lazyModule } from "../../lazy/lazy-module";
import { escapeHtml } from "../../utils/html";

/**
 * KaTeX - its code, stylesheet and fonts - is loaded the first time a
 * formula is drawn: most documents and replies have none, and it was a
 * good part of the bundle every window loads at start. A renderer asks
 * `katexNow()`, which starts the load and is null until it is done, and
 * draws again on `onKatexReady`. A document that has maths waits for it
 * before it opens (document-view/EditorPane.tsx's KatexFirst), so its
 * formulas never show as source for a moment.
 */
type Katex = typeof import("katex").default;

let katex: Katex | null = null;
let firstLoad: Promise<void> | null = null;
const listeners = new Set<() => void>();

// A failed load is tried again by the next formula drawn (lazy-module.ts).
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

/** The first load, settled either way - for a caller that waits for it
 *  and opens without KaTeX if it fails rather than not at all. The same
 *  promise every time, so React's `use` can wait on it. */
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

// `$`, `\(` or `\[` - every way markdown here writes a formula
// (utils/markdown-math.ts). A price's "$" says yes too, which only loads
// KaTeX early.
const MATH_HINT = /\$|\\\(|\\\[/;

/** Whether `markdown` may have a formula, for loading KaTeX before it is
 *  drawn. */
export function mayHaveMath(markdown: string): boolean {
  return MATH_HINT.test(markdown);
}

/** True once KaTeX has loaded: a memo key that renders the component
 *  again then. */
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
