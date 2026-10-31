import type { KatexOptions } from "katex";

type Katex = typeof import("katex").default;

// KaTeX stacks a matrix's rows as LaTeX does, with no gap beyond a strut, so
// rows of fractions touch (#476). Typora (MathJax) leaves room between them;
// matrices here get a taller \arraystretch, unless the formula sets its own.
// Only matrices: aligned and cases read \arraystretch too, and look right.
const MATRIX_STRETCH = "1.4";
const MATRIX_BEGIN = /\\begin\s*\{[pbBvV]?matrix\*?\}/g;
const MATRIX_END = /\\end\s*\{[pbBvV]?matrix\*?\}/g;

/** The source with each matrix's rows spaced apart, or as it was. */
export function spaceMatrixRows(source: string): string {
  if (!source.includes("matrix") || source.includes("\\arraystretch"))
    return source;
  // \begingroup scopes the \def without making the matrix an ordinary atom,
  // so the spacing around it is unchanged.
  return source
    .replace(
      MATRIX_BEGIN,
      `\\begingroup\\def\\arraystretch{${MATRIX_STRETCH}}$&`,
    )
    .replace(MATRIX_END, "$&\\endgroup");
}

/** `katex.renderToString` with matrix rows spaced apart. */
export function renderFormula(
  katex: Katex,
  source: string,
  options: KatexOptions,
): string {
  const spaced = spaceMatrixRows(source);
  const html = katex.renderToString(spaced, options);
  // A formula KaTeX can't read is shown as its source: the one typed.
  return spaced !== source && html.includes("katex-error")
    ? katex.renderToString(source, options)
    : html;
}
