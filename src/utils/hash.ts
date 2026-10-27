/** FNV-1a (32-bit) over UTF-16 code units: a cheap, stable hash for keys and
 *  seeds, never for anything that must resist collisions. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
