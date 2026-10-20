/**
 * Colour codes a swatch can show (#146): inline code that is one colour,
 * and colour codes written in a block's plain text. Both name the colour
 * outright - hex or a CSS colour function with plain numbers - so `red`,
 * `currentColor` or `var(--x)` never get one.
 */

// Plain numbers only - the same idea as raw HTML's style check
// (html/html-policy.ts), stricter.
const NUM = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`;
const PCT = `${NUM}%`;
const NUM_OR_PCT = `${NUM}%?`;
const HUE = `${NUM}(?:deg|grad|rad|turn)?`;
const ALPHA = String.raw`(?:\s*\/\s*${NUM_OR_PCT})?`;
const SPACES = String.raw`color\(\s*(?:srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65)`;
const FUNCTION_FORMS = [
  // rgb(1, 2, 3) / rgba(1, 2, 3, .5) and rgb(1 2 3 / 50%)
  String.raw`rgba?\(\s*${NUM_OR_PCT}\s*,\s*${NUM_OR_PCT}\s*,\s*${NUM_OR_PCT}\s*(?:,\s*${NUM_OR_PCT}\s*)?\)`,
  String.raw`rgba?\(\s*${NUM_OR_PCT}\s+${NUM_OR_PCT}\s+${NUM_OR_PCT}${ALPHA}\s*\)`,
  // hsl(120, 50%, 50%) / hsla(...) and hsl(120deg 50% 50% / .5)
  String.raw`hsla?\(\s*${HUE}\s*,\s*${PCT}\s*,\s*${PCT}\s*(?:,\s*${NUM_OR_PCT}\s*)?\)`,
  String.raw`hsla?\(\s*${HUE}\s+${NUM_OR_PCT}\s+${NUM_OR_PCT}${ALPHA}\s*\)`,
  // oklch(70% 0.1 120 / .5), oklab(0.7 -0.1 0.1)
  String.raw`oklch\(\s*${NUM_OR_PCT}\s+${NUM_OR_PCT}\s+${HUE}${ALPHA}\s*\)`,
  String.raw`oklab\(\s*${NUM_OR_PCT}\s+${NUM_OR_PCT}\s+${NUM_OR_PCT}${ALPHA}\s*\)`,
  // color(display-p3 1 0.5 0 / .5)
  String.raw`${SPACES}\s+${NUM_OR_PCT}\s+${NUM_OR_PCT}\s+${NUM_OR_PCT}${ALPHA}\s*\)`,
];
const HEX = "#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})";
const CODE_RE = new RegExp(`^(?:${[HEX, ...FUNCTION_FORMS].join("|")})$`, "i");

// The pattern lets through a few the browser refuses (percentages and
// numbers mixed in the comma form); it has the last word where it can be
// asked. Remembered, since a document repeats its few colours.
const taken = new Map<string, boolean>();
function browserTakes(value: string): boolean {
  if (typeof CSS === "undefined" || !CSS.supports) return true;
  let ok = taken.get(value);
  if (ok === undefined) {
    ok = CSS.supports("color", value);
    if (taken.size > 1000) taken.clear();
    taken.set(value, ok);
  }
  return ok;
}

/** The colour inline code's text is, when a swatch can show it: hex,
 *  rgb()/rgba(), hsl()/hsla(), oklch(), oklab() or color() - never a bare
 *  keyword. Else null. */
export function colorOfCode(text: string): string | null {
  const value = text.trim();
  return CODE_RE.test(value) && browserTakes(value) ? value : null;
}

/** Stands for what isn't the block's own text - inline code, a wikilink,
 *  an image, raw HTML - in the string findColorCodes reads. */
export const OPAQUE = "\uFFFC";

export interface ColorCode {
  /** Offsets of the code in the text. */
  from: number;
  to: number;
  color: string;
}

// Six or eight digits only: in prose a short one is as often a tag
// (#add, #cafe) or an issue (#234) as a colour.
const HEX_RE = /#([0-9a-f]{8}|[0-9a-f]{6})/gi;
const FUNCTION_RE = new RegExp(`(?:${FUNCTION_FORMS.join("|")})`, "gi");

// Scripts written without spaces between words, where a colour code can
// follow a letter directly: 颜色#ff8800.
const CJK =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
// Next to a hex code, these make it part of something else: a word, a
// path or URL (`/#fff`, `?c=#fff`, `x.com#fff`), a footnote (`[^#fff]`),
// another tag or code (`#fff#000`, `#fff-dark`).
const WORDLIKE = /[\p{L}\p{N}_\-#/\\@&=?%~+^*$]/u;
const BEFORE_FUNCTION = /[\p{L}\p{N}_\-.]/u;

const isWordlike = (ch: string | undefined) =>
  ch !== undefined && WORDLIKE.test(ch) && !CJK.test(ch);

// English words spelled in hex digits, six or eight long: tags, not
// colours (#facade).
const HEX_WORDS = new Set([
  "accede",
  "beaded",
  "bedded",
  "dabbed",
  "decade",
  "deface",
  "efface",
  "facade",
]);

/** The whitespace-delimited stretch of `text` around [from, to). */
function tokenAround(text: string, from: number, to: number): string {
  let start = from;
  let end = to;
  while (start > 0 && !/[\s\uFFFC]/.test(text[start - 1])) start--;
  while (end < text.length && !/[\s\uFFFC]/.test(text[end])) end++;
  return text.slice(start, end);
}

const inUrl = (token: string) => /:\/\/|www\./i.test(token);

/**
 * The colour codes written in a block's text, in order. A hex code counts
 * only as a token of its own - not inside a word, a URL or a path - and
 * only with six or eight digits that don't spell a word, so Obsidian tags
 * (#add, #cafe, #facade) and issue numbers (#234) stay plain; inline code
 * takes the short forms (colorOfCode). Colour functions
 * count wherever their syntax is whole. Colour names never do.
 */
export function findColorCodes(text: string): ColorCode[] {
  const found: ColorCode[] = [];
  for (const match of text.matchAll(HEX_RE)) {
    const from = match.index;
    const to = from + match[0].length;
    if (HEX_WORDS.has(match[1].toLowerCase())) continue;
    if (isWordlike(text[from - 1]) || isWordlike(text[to])) continue;
    // "#fff.png", "#fff:hover": a file name or a selector, not a colour.
    if (/[.:,;]/.test(text[to] ?? "") && /\w/.test(text[to + 1] ?? ""))
      continue;
    if (inUrl(tokenAround(text, from, to))) continue;
    if (browserTakes(match[0])) found.push({ from, to, color: match[0] });
  }
  for (const match of text.matchAll(FUNCTION_RE)) {
    const from = match.index;
    const to = from + match[0].length;
    const before = text[from - 1];
    if (
      before !== undefined &&
      BEFORE_FUNCTION.test(before) &&
      !CJK.test(before)
    )
      continue;
    if (inUrl(tokenAround(text, from, to))) continue;
    if (browserTakes(match[0])) found.push({ from, to, color: match[0] });
  }
  return found.sort((a, b) => a.from - b.from);
}
