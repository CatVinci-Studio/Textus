/// The themes Textus AI writes in a reply: found in its Markdown, so the chat
/// can offer "Use this theme" under it.

/** A ```css block of a reply that is a whole, installable theme. */
export interface ReplyTheme {
  css: string;
  /** From its first comment, `/* Name - ... *\/`; null when it has none. */
  name: string | null;
}

const CSS_FENCE = /^(`{3,}|~{3,})[ \t]*css[ \t]*\n([\s\S]*?)\n\1[ \t]*$/gim;

/** CSS escapes resolved (`\75 rl(` is `url(`), so the check below can't be
 *  dodged by spelling a word with them. */
function decodeEscapes(css: string): string {
  return css.replace(
    /\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^\n0-9a-fA-F])/g,
    (_, hex: string | undefined, ch: string | undefined) =>
      hex
        ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff))
        : (ch ?? ""),
  );
}

/** Whether a stylesheet loads nothing from elsewhere: no `@import`, and every
 *  `url()` a `data:` URI. Model output is untrusted and a theme stays applied
 *  on every launch, so one that would fetch a file is not offered. */
export function isSelfContained(css: string): boolean {
  const text = decodeEscapes(
    css.replace(/\/\*[\s\S]*?\*\//g, ""),
  ).toLowerCase();
  if (/@import\b/.test(text)) return false;
  for (const m of text.matchAll(
    /(?<![\w-])(?:url|src)\(\s*(['"]?)\s*([^'")\s]*)/g,
  ))
    if (!m[2].startsWith("data:")) return false;
  return !/image-set\(\s*['"](?!data:)/.test(text);
}

/** The name in a theme's first comment (`/* Midnight Ink - ... *\/`). */
export function themeName(css: string): string | null {
  const m = /^\s*\/\*!?\s*([^\n]*?)\s*(?:\s[-–—:]\s|\*\/|\n)/.exec(css);
  const name = m?.[1].replace(/\*\/$/, "").trim();
  return name ? name.slice(0, 60) : null;
}

/** The installable themes in a reply: closed ```css blocks that style the
 *  document and load nothing from elsewhere. A block still streaming has no
 *  closing fence, so it is offered only once whole. */
export function themesInReply(markdown: string): ReplyTheme[] {
  const themes: ReplyTheme[] = [];
  for (const m of markdown.matchAll(CSS_FENCE)) {
    const css = m[2].trim();
    if (!/#write\b|--doc-[a-z]/.test(css) || !isSelfContained(css)) continue;
    themes.push({ css: `${css}\n`, name: themeName(css) });
  }
  return themes;
}
