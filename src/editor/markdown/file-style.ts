import { tokenize } from "./escapes-as-written";
import { tableInTheFilesHand } from "./table-style";

/**
 * A changed run, as the serializer writes it, brought closer to how a
 * person writes Markdown and to how its file wrote it. The serializer
 * escapes every character that could be syntax somewhere and has one way to
 * write a list, an emphasis and a heading; each change here is kept only
 * where `reads` says the text still reads as the same blocks.
 */

/** `written` without the backslashes it reads the same without: `a_b`,
 *  a `[` that opens no link. All of them where that reads the same, else
 *  character by character, every escape of one together: a pair of stars
 *  is never left half escaped. */
export function withoutNeedlessEscapes(
  written: string,
  reads: (text: string) => boolean,
): string {
  const tokens = tokenize(written);
  const escaped = new Set(
    tokens.flatMap((token) =>
      token.form.length === 2 && token.form[0] === "\\" ? [token.char] : [],
    ),
  );
  if (escaped.size === 0) return written;
  const without = (plain: Set<string>) =>
    tokens
      .map((token) =>
        token.form[0] === "\\" && plain.has(token.char)
          ? token.char
          : token.form,
      )
      .join("");
  const all = without(escaped);
  if (reads(all)) return all;
  const plain = new Set<string>();
  for (const char of escaped) {
    plain.add(char);
    if (!reads(without(plain))) plain.delete(char);
  }
  return without(plain);
}

const STARS = /(?<![\\*])\*{1,2}(?!\*)/g;
const EMPHASIS =
  /(?<![\\*_\w])(?:\*{1,2}|_{1,2})(?![*_])|(?<![\\*_])(?:\*{1,2}|_{1,2})(?![*_\w])/g;

/** A list's marker at a line's start, an emphasis's, a heading underlined:
 *  each as `original` has it, where the serializer wrote its own. */
const HANDS: ((original: string, written: string) => string | null)[] = [
  // Bullets: "* item" or "+ item" for the serializer's "- item".
  (original, written) => {
    const theirs = /^[ \t]*([*+])[ \t]+\S/m.exec(original)?.[1];
    if (!theirs || /^[ \t]*-[ \t]+\S/m.test(original)) return null;
    return written.replace(/^([ \t]*)-(?=[ \t])/gm, `$1${theirs}`);
  },
  // Emphasis: _word_ and __word__ for *word* and **word**.
  (original, written) => {
    const under = /(^|[\s(["'])_{1,2}[^\s_]/m.test(original);
    if (!under) return null;
    // Both kinds in the file: each emphasis as the one in its place there.
    const theirs = [...original.matchAll(EMPHASIS)].map((m) => m[0]);
    const ours = [...written.matchAll(STARS)];
    if (theirs.length === ours.length) {
      let k = 0;
      return written.replace(STARS, (stars: string) => {
        const their = theirs[k++];
        return their.length === stars.length ? their : stars;
      });
    }
    const star = /(^|[^\\*\n])\*{1,2}[^\s*]/.test(original);
    if (star) return null;
    return written.replace(STARS, (stars: string) => "_".repeat(stars.length));
  },
  // A heading with its line of = or - under it.
  (original, written) => {
    const under = /^[^\n]+\n(=+|-+)[ \t]*$/.exec(original)?.[1];
    const heading = /^(#{1,2}) ([^\n]+)$/.exec(written);
    if (!under || !heading) return null;
    const line = (heading[1].length === 1 ? "=" : "-").repeat(under.length);
    return `${heading[2]}\n${line}`;
  },
  // A heading closed with #s: "# h #".
  (original, written) => {
    const closing = /^#{1,6} [^\n]*? (#+)[ \t]*$/m.exec(original)?.[1];
    if (!closing || !/^#{1,6} [^\n]+$/.test(written)) return null;
    return `${written} ${closing}`;
  },
  // Numbered lists: "1)" for "1.", and the same number on every item.
  (original, written) => {
    const numbers = [...original.matchAll(/^[ \t]*(\d+)([.)])[ \t]/gm)];
    if (!numbers.length) return null;
    const paren = numbers.every((n) => n[2] === ")");
    const one =
      numbers.length > 1 && numbers.every((n) => n[1] === numbers[0][1]);
    if (!paren && !one) return null;
    return written.replace(
      /^([ \t]*)(\d+)\.(?=[ \t])/gm,
      (_all, indent: string, n: string) =>
        `${indent}${one ? numbers[0][1] : n}${paren ? ")" : "."}`,
    );
  },
  // Bullets nested four spaces deep, for the serializer's two.
  (original, written) => {
    if (!/^ {4}[-*+][ \t]/m.test(original) || /^ {2}[-*+][ \t]/m.test(original))
      return null;
    if (/^[ \t]*(\d+[.)]|`{3}|~{3})/m.test(written)) return null;
    return written.replace(/^((?: {2})+)(?=\S)/gm, (indent) => indent + indent);
  },
  // Code fenced with ~~~.
  (original, written) => {
    if (!/^[ \t]*~{3}/m.test(original) || /^[ \t]*`{3}/m.test(original))
      return null;
    return written.replace(
      /^([ \t]*)(`{3,})/gm,
      (_all, indent: string, ticks: string) =>
        indent + "~".repeat(ticks.length),
    );
  },
  // A line broken with two spaces, for the serializer's backslash.
  (original, written) => {
    if (!/ {2,}\n/.test(original) || /(?<!\\)\\\n/.test(original)) return null;
    return written.replace(/(?<!\\)\\\n/g, "  \n");
  },
  tableInTheFilesHand,
];

/** `written` in `original`'s own hand, each way taken where it reads the
 *  same. */
export function inTheFilesHand(
  original: string,
  written: string,
  reads: (text: string) => boolean,
): string {
  // Block by block where the two hold as many: one paragraph's stars don't
  // stop the next one's underscores.
  const theirs = original.split(BLOCK_GAP);
  const ours = written.split(BLOCK_GAP);
  if (theirs.length > 1 && theirs.length === ours.length) {
    const each = ours
      .map((part, k) => (k % 2 ? part : inOneHand(theirs[k], part, () => true)))
      .join("");
    if (each !== written && reads(each)) return each;
  }
  return inOneHand(original, written, reads);
}

/** Blank lines before a line at the margin: between two top-level blocks.
 *  Kept by the split, as odd parts. */
const BLOCK_GAP = /(\n{2,}(?=\S))/;

function inOneHand(
  original: string,
  written: string,
  reads: (text: string) => boolean,
): string {
  let text = written;
  for (const hand of HANDS) {
    const next = hand(original, text);
    if (next !== null && next !== text && reads(next)) text = next;
  }
  return text;
}
