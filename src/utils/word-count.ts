import { eachLine } from "./markdown-lines";
import { onMemoryIdle } from "./memory-idle";

interface WordCount {
  words: number;
  /** Letters, digits and CJK punctuation - what 文字数 counts: no spaces,
   *  no Markdown marks. */
  characters: number;
}

const segmenter: Intl.Segmenter | undefined =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : undefined;

/** Han characters, kana and iteration marks each count, as writers there
 *  count length. Hangul is spaced and counts by word. */
const CJK_CHAR =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々〆〇]/gu;

/** What a character count takes: letters (kana and Han included), digits
 *  and the CJK punctuation a Japanese count keeps. */
const COUNTED_CHAR = /[\p{L}\p{N}\u3000-\u303f\uff01-\uff0f\uff1a-\uff20]/gu;

/** The words of a stretch of prose with no blank line in it. */
function countText(text: string): number {
  if (!segmenter) {
    let words = 0;
    for (const chunk of text.trim().split(/\s+/).filter(Boolean)) {
      const cjk = chunk.match(CJK_CHAR)?.length ?? 0;
      words +=
        cjk + (chunk.replace(CJK_CHAR, "").match(/[\p{L}\p{N}]/u) ? 1 : 0);
    }
    return words;
  }
  let words = 0;
  for (const { segment, isWordLike } of segmenter.segment(text)) {
    if (!isWordLike) continue;
    words += segment.match(CJK_CHAR)?.length || 1;
  }
  return words;
}

// Each paragraph's count, cached by its text: segmenting a long document
// whole after every edit was slow, and no word crosses a line break. Kept to
// PARAGRAPHS_KEPT or twice the last count's paragraphs, whichever is more;
// past that only the last count's paragraphs stay. (Cleared at a fixed cap,
// a longer document was recounted whole on every edit; keeping only the last
// count, switching back from another tab recounted it whole.)
const PARAGRAPHS_KEPT = 50_000;
const paragraphCounts = new Map<string, readonly [number, number]>();
onMemoryIdle(() => paragraphCounts.clear());

/** An image's turn or width kept in its title (`{textus-rotate=90}`,
 *  images/image-rotation.ts): layout, not words. */
const IMAGE_TITLE_METADATA =
  /\{(?:\s*(?:textus|levis)-(?:width|rotate)=[^\s}]*)+\s*\}/g;

/** A paragraph's words and characters. */
function countParagraph(text: string): readonly [number, number] {
  let counts = paragraphCounts.get(text);
  if (counts === undefined) {
    const prose = text.replace(IMAGE_TITLE_METADATA, "");
    counts = [countText(prose), prose.match(COUNTED_CHAR)?.length ?? 0];
    paragraphCounts.set(text, counts);
  }
  return counts;
}

/**
 * Counts words via Intl.Segmenter - Chinese and Japanese count each
 * character (红楼梦 is three) - and characters as 文字数 does; fenced code
 * blocks are left out.
 */
export function countWords(markdown: string): WordCount {
  let words = 0;
  let characters = 0;
  let paragraph = "";
  const paragraphs: string[] = [];
  const flush = () => {
    if (paragraph) {
      const [w, c] = countParagraph(paragraph);
      words += w;
      characters += c;
      paragraphs.push(paragraph);
    }
    paragraph = "";
  };
  eachLine(
    markdown,
    (line, _index, code) => {
      if (code || line.trim() === "") flush();
      else paragraph += line + "\n";
    },
    { frontMatter: true },
  );
  flush();
  if (paragraphCounts.size > Math.max(PARAGRAPHS_KEPT, 2 * paragraphs.length)) {
    const kept = paragraphs.map(
      (text) => [text, paragraphCounts.get(text)!] as const,
    );
    paragraphCounts.clear();
    for (const [text, count] of kept) paragraphCounts.set(text, count);
  }
  return { words, characters };
}
