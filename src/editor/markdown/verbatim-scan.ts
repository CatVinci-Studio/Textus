/** `[start, end)` offsets in a document's text. */
export type Range = [number, number];

const TAG_START = /[A-Za-z>/]/;
const QUOTES = new Set(['"', "'", "`"]);

/**
 * The `{…}` expressions and JSX tags in `source` (at `base` in the
 * document), outermost only, jumping over `skip` (code, HTML already
 * read). `open`: something was still open at the end.
 */
export function scanSource(
  source: string,
  base: number,
  skip: Range[],
  rules: { braces: boolean; jsx: boolean },
): { ranges: Range[]; open: boolean } {
  const ranges: Range[] = [];
  let depth = 0;
  let start = -1;
  let tag = -1;
  let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const at = base + i;
    const jump = skip.find(([s, e]) => at >= s && at < e);
    if (jump) {
      i = jump[1] - base - 1;
      continue;
    }
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\") i++;
    } else if (depth === 0 && tag < 0) {
      if (ch === "\\") i++;
      else if (ch === "{" && rules.braces) [start, depth] = [at, 1];
      else if (ch === "<" && rules.jsx && TAG_START.test(source[i + 1] ?? ""))
        tag = at;
    } else if (depth > 0 && ch === "/" && "*/".includes(source[i + 1] ?? "#")) {
      // A comment in an expression, its apostrophes and braces no code's.
      const end = source.indexOf(source[i + 1] === "*" ? "*/" : "\n", i + 2);
      i = end < 0 ? source.length : end + (source[i + 1] === "*" ? 1 : 0);
    } else if (QUOTES.has(ch) && (depth > 0 || ch !== "`")) quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && depth > 0) {
      if (--depth === 0 && tag < 0) ranges.push([start, at + 1]);
    } else if (ch === ">" && depth === 0 && tag >= 0) {
      ranges.push([tag, at + 1]);
      tag = -1;
    }
  }
  return { ranges, open: depth > 0 || tag >= 0 || quote !== null };
}
