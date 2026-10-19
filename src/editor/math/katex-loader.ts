import { useEffect, useState } from "react";

/**
 * KaTeX is the largest library in the app (≈580 KB of source) and most
 * documents and replies have no formula. It is fetched the first time a
 * formula is rendered; until then callers show the source, and redraw when
 * `onKatexReady` fires.
 */
type Katex = typeof import("katex").default;

let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;
const listeners = new Set<() => void>();

export function loadKatex(): Promise<Katex> {
  loading ??= import("katex").then(
    (module) => {
      katex = module.default;
      for (const listener of listeners) listener();
      listeners.clear();
      return katex;
    },
    (error) => {
      // A failed fetch can be tried again on the next formula.
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** KaTeX if loaded; otherwise starts loading it and returns null. */
export function katexNow(): Katex | null {
  if (!katex) void loadKatex();
  return katex;
}

export function onKatexReady(listener: () => void): () => void {
  if (katex) return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders a component once KaTeX arrives (a memo key). */
export function useKatexReady(): boolean {
  const [ready, setReady] = useState(katex !== null);
  useEffect(() => {
    if (ready) return;
    // Loaded between this render and the effect: no event will come.
    if (katex) {
      setReady(true);
      return;
    }
    return onKatexReady(() => setReady(true));
  }, [ready]);
  return ready;
}

export function mathSourceHtml(source: string): string {
  const escaped = source
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<code class="math-pending">${escaped}</code>`;
}
