/** A length in the first design's pixels, as Interface Size's Medium draws
 *  it: a tenth larger, on an even pixel from 4 up. For plugin pages and
 *  sizes kept before 1.4.1. */
export function atMedium(n: number): number {
  const x = Math.abs(n) * 1.1;
  const r = Math.round(x);
  return Math.sign(n) * (r % 2 && x >= 4 ? Math.round(x / 2) * 2 : r);
}
