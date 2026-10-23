/** FNV-1a (32-bit) over the string's UTF-16 code units: a cheap, stable
 *  hash for keys and seeds, never for anything that must resist collisions.
 *  ai/doc-blocks.ts keeps its own over UTF-8 bytes, because its ids have to
 *  match the backend's (src-tauri/src/ai/doc_blocks.rs). */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
