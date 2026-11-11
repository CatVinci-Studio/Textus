/** Kana and CJK ideographs - scripts written without spaces between words. */
const CJK_LETTERS =
  "\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff";
/** CJK punctuation and full-width forms. */
const CJK_PUNCTUATION = "\\u3000-\\u303f\\uff00-\\uffef";

const CJK_LETTER = new RegExp(`[${CJK_LETTERS}]`);
const CJK_ANY = new RegExp(`[${CJK_LETTERS}${CJK_PUNCTUATION}]`);
const CJK_CHUNK = new RegExp(`^[${CJK_LETTERS}]{1,2}[${CJK_PUNCTUATION}]*`);

/** Han, kana or Hangul: the scripts of Chinese, Japanese and Korean,
 *  punctuation not included. */
export const CJK_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** CJK script or CJK punctuation and full-width forms: a character set
 *  wide, as much as two Latin ones to read. */
const WIDE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\ufe30-\ufe4f\uff00-\uffef]/u;

export function isWide(ch: string): boolean {
  return WIDE.test(ch);
}

/** A letter or digit of a script that spaces its words: not CJK's. */
export function isSpacedWordChar(ch: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(ch) && !CJK_SCRIPT.test(ch);
}

/** A kana or ideograph character. */
export function isCjkLetter(ch: string): boolean {
  return CJK_LETTER.test(ch);
}

/** Any CJK character, punctuation included - next to one, no space goes. */
export function isCjk(ch: string): boolean {
  return CJK_ANY.test(ch);
}

/** Up to two CJK letters at the start of `text` plus the punctuation right
 *  after them - the "word" step through text that has no spaces. */
export function cjkChunk(text: string): string | null {
  return CJK_CHUNK.exec(text)?.[0] ?? null;
}
