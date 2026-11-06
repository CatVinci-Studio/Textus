const citation = (inner: string) => /^[\d,\s-]*$/.test(inner);

/** Whether `\[…\]`'s inside reads as LaTeX: CommonMark takes `\[x\]` for
 *  escaped brackets ("[optional]" in a README), and `\[1\]` cites. */
export const looksLikeLatex = (inner: string) =>
  !citation(inner) && /[\\^_{}=+\-*/<>|]/.test(inner);

/**
 * Rewrites LaTeX's `\(...\)` / `\[...\]` as `$...$` / `$$...$$` for AI
 * replies, pastes and rendered HTML; LLMs use the backslash form even when
 * asked not to. `\[…\]` must look like LaTeX, a `\(…\)` not like a
 * citation, and fenced code is skipped.
 */
export function normalizeMathDelimiters(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/)
    .map((segment, i) =>
      i % 2 === 1
        ? segment
        : segment
            .replace(
              /^([ \t]*)\\\[((?:(?!\\\])[\s\S])*?)\\\][ \t]*$/gm,
              (whole, indent: string, inner: string) =>
                !looksLikeLatex(inner)
                  ? whole
                  : `${indent}$$\n${inner.trim()}\n${indent}$$`,
            )
            .replace(/\\\[([\s\S]*?)\\\]/g, (whole, inner: string) =>
              !looksLikeLatex(inner) ? whole : `$$${inner.trim()}$$`,
            )
            .replace(/\\\(([\s\S]*?)\\\)/g, (whole, inner: string) =>
              citation(inner) ? whole : `$${inner.trim()}$`,
            ),
    )
    .join("");
}
