/**
 * Rewrites LaTeX's `\(...\)` / `\[...\]` as `$...$` / `$$...$$` for AI
 * replies, pastes and rendered HTML; LLMs use the backslash form even when
 * asked not to. A citation-like `\[1\]` stays, and fenced code is skipped.
 */
export function normalizeMathDelimiters(text: string): string {
  const citation = (inner: string) => /^[\d,\s-]*$/.test(inner);
  return text
    .split(/(```[\s\S]*?```)/)
    .map((segment, i) =>
      i % 2 === 1
        ? segment
        : segment
            .replace(
              /^([ \t]*)\\\[((?:(?!\\\])[\s\S])*?)\\\][ \t]*$/gm,
              (whole, indent: string, inner: string) =>
                citation(inner)
                  ? whole
                  : `${indent}$$\n${inner.trim()}\n${indent}$$`,
            )
            .replace(/\\\[([\s\S]*?)\\\]/g, (whole, inner: string) =>
              citation(inner) ? whole : `$$${inner.trim()}$$`,
            )
            .replace(/\\\(([\s\S]*?)\\\)/g, (whole, inner: string) =>
              citation(inner) ? whole : `$${inner.trim()}$`,
            ),
    )
    .join("");
}
