import { useMemo } from "react";
import { useKatexReady } from "./katex-loader";

/**
 * `render(text)` memoized for the text, and redone once KaTeX has loaded;
 * until then formulas show as their source.
 */
export function useKatexHtml(
  text: string,
  render: (text: string) => string,
): string {
  const katexReady = useKatexReady();
  const source = useMemo(() => ({ text, katexReady }), [text, katexReady]);
  return useMemo(() => render(source.text), [source, render]);
}
