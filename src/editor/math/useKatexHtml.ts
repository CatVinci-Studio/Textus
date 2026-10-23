import { useMemo } from "react";
import { useKatexReady } from "./katex-loader";

/**
 * `render(text)` - Markdown to HTML with its formulas - remembered for the
 * text, and drawn again once KaTeX is here: a first formula loads it, and
 * until then the formulas show as their source (a chat reply, the split
 * view's preview).
 */
export function useKatexHtml(
  text: string,
  render: (text: string) => string,
): string {
  const katexReady = useKatexReady();
  // What is rendered: the text, and whether KaTeX is here to draw it.
  const source = useMemo(() => ({ text, katexReady }), [text, katexReady]);
  return useMemo(() => render(source.text), [source, render]);
}
