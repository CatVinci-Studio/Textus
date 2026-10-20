import { type ReactNode, use, useState } from "react";
import { katexFirstLoad, katexLoaded, mayHaveMath } from "./katex-loader";

/**
 * Holds `children` (an editor) back, under the nearest Suspense, until
 * KaTeX has loaded when `markdown` may have a formula - so a document with
 * maths opens with its formulas drawn rather than as TeX source for a
 * moment. Any other document opens at once; a formula typed into it later
 * loads KaTeX then (katex-loader.ts).
 */
export function KatexFirst({
  markdown,
  children,
}: {
  markdown: string;
  children: ReactNode;
}) {
  // Read as it opens: a formula typed afterwards must not hide the editor
  // behind Suspense while KaTeX loads.
  const [hasMath] = useState(() => mayHaveMath(markdown));
  if (hasMath && !katexLoaded()) use(katexFirstLoad());
  return children;
}
