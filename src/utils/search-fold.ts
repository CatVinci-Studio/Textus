/**
 * Text as every search box compares it: case, Unicode form, full- or
 * half-width forms (an IME's Ａ) and the accents on Latin letters folded
 * away, so "cafe" finds "Café". Marks on other scripts stay: が is not か.
 */
export function searchFold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase();
}
