import { type ReactNode, use, useState } from "react";
import { katexFirstLoad, katexLoaded, mayHaveMath } from "./katex-loader";

/**
 * Holds `children` back under the nearest Suspense until KaTeX has loaded
 * when `markdown` may have a formula, so formulas open drawn, not as source.
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
