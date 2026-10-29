/**
 * Text as a search compares it: case, Unicode form and the accents on Latin
 * letters folded away, so "cafe" finds "Café" (macOS hands names over
 * decomposed, a typed query arrives composed). Marks on other scripts stay:
 * が is not か.
 */
export function searchFold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase();
}
