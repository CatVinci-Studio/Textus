export interface WordCount {
  words: number;
}

const segmenter: Intl.Segmenter | undefined =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : undefined;

/** Han characters, kana and the iteration marks: in Chinese and Japanese
 *  every one counts, the way writers there count length (字数). Hangul is
 *  written in spaced words and counts by word. */
const CJK_CHAR =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々〆〇]/gu;

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

// Each paragraph's count, by its text. The count is taken again after
// every edit, and segmenting a long document whole took a quarter of a
// second each time (a 300k-character one); an edit changes a paragraph
// or two, and a word never runs across a line break, so the sum of the
// paragraphs' counts is the document's. The cap only bounds a session.
const PARAGRAPHS_KEPT = 50_000;
const paragraphCounts = new Map<string, number>();

function countParagraph(text: string): number {
  let words = paragraphCounts.get(text);
  if (words === undefined) {
    words = countText(text);
    if (paragraphCounts.size >= PARAGRAPHS_KEPT) paragraphCounts.clear();
    paragraphCounts.set(text, words);
  }
  return words;
}

/**
 * Counts words via Intl.Segmenter, which locates word boundaries in
 * scripts without spaces as well as Latin text. A word of Chinese or
 * Japanese counts each of its characters, as their word counters do, so
 * 红楼梦 is three, not one. Fenced code blocks are excluded so code
 * doesn't inflate the prose count.
 */
export function countWords(markdown: string): WordCount {
  let words = 0;
  let paragraph = "";
  let inFence = false;
  const flush = () => {
    if (paragraph) words += countParagraph(paragraph);
    paragraph = "";
  };
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      flush();
      continue;
    }
    if (inFence) continue;
    if (line.trim() === "") flush();
    else paragraph += line + "\n";
  }
  flush();
  return { words };
}
