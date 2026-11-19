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

/**
 * Display maths whose `$$` lines touch the text around them, given blank
 * lines, for marked: it reads such a block as part of the paragraph above,
 * and a lone `=` line inside as that paragraph's heading underline. The
 * editor's parser reads them as a formula already. Fenced code is skipped.
 */
export function displayMathApart(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/)
    .map((segment, i) => (i % 2 === 1 ? segment : apart(segment)))
    .join("");
}

function apart(segment: string): string {
  const lines = segment.split("\n");
  const out: string[] = [];
  let open = false;
  const blankBefore = () => {
    if (out.length && out[out.length - 1].trim()) out.push("");
  };
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!open && t.startsWith("$$")) {
      blankBefore();
      out.push(line);
      // `$$x = 1$$` on one line closes at once.
      open = !(t.length > 2 && t.endsWith("$$"));
    } else if (open && t.endsWith("$$")) {
      out.push(line);
      open = false;
    } else {
      out.push(line);
      return;
    }
    if (!open && lines[i + 1]?.trim()) out.push("");
  });
  return out.join("\n");
}
