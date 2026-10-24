/**
 * How alike two sentences are, the same way for CJK and for spaced
 * scripts: the measure sentence-diff.ts aligns a rewrite's sentences by.
 */

/** Character bigrams (single characters for one-character text), for a
 *  similarity that works the same for CJK and for spaced scripts. */
function bigrams(text: string): Map<string, number> {
  const known = bigramCache.get(text);
  if (known) return known;
  const chars = [...text.replace(/\s+/g, " ").trim().toLowerCase()];
  const grams = new Map<string, number>();
  const add = (g: string) => grams.set(g, (grams.get(g) ?? 0) + 1);
  if (chars.length < 2) chars.forEach(add);
  for (let k = 0; k + 1 < chars.length; k++) add(chars[k] + chars[k + 1]);
  // The alignment compares the same sentences (and pairs of them) many
  // times over - and again for every sentence a streaming rewrite adds.
  if (bigramCache.size >= BIGRAM_CACHE) bigramCache.clear();
  bigramCache.set(text, grams);
  return grams;
}

const BIGRAM_CACHE = 4096;
const bigramCache = new Map<string, Map<string, number>>();

/** Dice similarity of two texts' bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  let total = 0;
  let shared = 0;
  for (const n of x.values()) total += n;
  for (const [g, n] of y) {
    total += n;
    shared += Math.min(n, x.get(g) ?? 0);
  }
  return total === 0 ? 0 : (2 * shared) / total;
}

/** Below this, two sentences are not the same sentence rewritten. */
export const MATCH = 0.25;
