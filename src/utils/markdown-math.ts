/**
 * The chat panel's markdown renderer, and the editor before a file is
 * involved, read maths in `$...$` / `$$...$$`; LLMs default to LaTeX's
 * `\(...\)` / `\[...\]` unless told otherwise (the system prompt,
 * AGENT_ROLE in src-tauri/src/ai/agent.rs, asks for `$`/`$$`, but this is a
 * backstop for replies that use the backslash form anyway). AI replies,
 * pastes (src/editor/markdown/parse-markdown-source.ts) and rendered chat
 * and HTML (render-html.ts) run through this first. A file opened in the
 * editor does not: it reads both forms as they are and writes them back
 * that way (src/editor/math/latex-math-syntax.ts).
 *
 * A `\[...\]` alone on its lines becomes a `$$` block; one inside a line,
 * inline `$$...$$`. A pair holding only a citation's characters (`\[1\]`,
 * `\[2, 3\]`, `\[4-6\]`) is an escaped bracket and stays. Skips fenced
 * code blocks so literal `\(` in a code sample isn't touched.
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
