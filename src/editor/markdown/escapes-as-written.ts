import { decodeNamedCharacterReference } from "decode-named-character-reference";

/**
 * An edited block written with the file's own escapes and entities wherever
 * its characters are unchanged: remark escapes every "[" and drops "\#", so
 * `- [/] task`, `^[note]` and `\#notatag` changed meaning in Obsidian on the
 * first edit, and `&nbsp;` became an invisible U+00A0.
 */

interface Token {
  /** The character it stands for. */
  char: string;
  /** How it is written: "x", "\\x" or "&name;". */
  form: string;
  plain: boolean;
}

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const ENTITY =
  /^&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([a-zA-Z][a-zA-Z0-9]{0,31}));/;

function entityAt(text: string, at: number): Token | null {
  const match = ENTITY.exec(text.slice(at, at + 40));
  if (!match) return null;
  const [form, hex, dec, name] = match;
  const code = hex ? parseInt(hex, 16) : dec ? parseInt(dec, 10) : null;
  const char =
    code !== null
      ? code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : false
      : decodeNamedCharacterReference(name);
  return char ? { char, form, plain: false } : null;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (let at = 0; at < text.length;) {
    const c = text[at];
    const next = text[at + 1];
    const token: Token =
      c === "\\" && next !== undefined && ASCII_PUNCTUATION.test(next)
        ? { char: next, form: c + next, plain: false }
        : ((c === "&" ? entityAt(text, at) : null) ?? {
            char: c,
            form: c,
            plain: true,
          });
    tokens.push(token);
    at += token.form.length;
  }
  return tokens;
}

/** Past this many differing characters the block is a rewrite, not an edit. */
const MAX_EDITS = 400;

/** For each of `b`'s tokens, the index of the `a` token it is matched with
 *  (Myers' diff on the characters), or null when there are too many edits. */
function matchTokens(a: Token[], b: Token[]): (number | null)[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x].char === b[y].char) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, offset, n, m, a, b);
    }
  }
  return null;
}

function backtrack(
  trace: Int32Array[],
  offset: number,
  n: number,
  m: number,
  a: Token[],
  b: Token[],
): (number | null)[] {
  const matched: (number | null)[] = new Array(m).fill(null);
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const v = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : v[offset + prevK];
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      if (a[x].char === b[y].char) matched[y] = x;
    }
    x = prevX;
    y = prevY;
  }
  return matched;
}

/** `written` with each character the edit left alone spelled as in
 *  `original`: escaped, as an entity, or plain. The caller checks it still
 *  reads the same. */
export function withEscapesAsWritten(
  original: string,
  written: string,
): string {
  if (original === written) return written;
  const a = tokenize(original);
  const b = tokenize(written);
  // The common ends need no diff, so only the edited middle is compared.
  let head = 0;
  while (head < a.length && head < b.length && a[head].char === b[head].char)
    head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail].char === b[b.length - 1 - tail].char
  )
    tail++;
  const middle = matchTokens(
    a.slice(head, a.length - tail),
    b.slice(head, b.length - tail),
  );
  if (!middle) return written;
  const from = (i: number): number | null => {
    if (i < head) return i;
    if (i >= b.length - tail) return i - b.length + a.length;
    const k = middle[i - head];
    return k === null ? null : k + head;
  };
  return b
    .map((token, i) => {
      const k = from(i);
      // Only an escape or an entity is taken back, never a character
      // the serializer wrote around it.
      if (k === null || (token.plain && a[k].plain)) return token.form;
      return a[k].form;
    })
    .join("");
}
