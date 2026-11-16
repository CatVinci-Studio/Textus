import { tokenize } from "./escapes-as-written";

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
    const star = /(^|[^\\*\n])\*{1,2}[^\s*]/.test(original);
    if (!under || star) return null;
    return written.replace(/(?<![\\*])(\*{1,2})(?!\*)/g, (stars: string) =>
      "_".repeat(stars.length),
    );
  },
  // A heading with its line of = or - under it.
  (original, written) => {
    const under = /^[^\n]+\n(=+|-+)[ \t]*$/.exec(original)?.[1];
    const heading = /^(#{1,2}) ([^\n]+)$/.exec(written);
    if (!under || !heading) return null;
    const line = (heading[1].length === 1 ? "=" : "-").repeat(under.length);
    return `${heading[2]}\n${line}`;
  },
];

/** `written` in `original`'s own hand, each way taken where it reads the
 *  same. */
export function inTheFilesHand(
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
