import { hasUrlScheme, isDrivePath, isNoteFile } from "./path";

/**
 * What a link to a note says, read one way for every reader: a click, a
 * hover, metadata, backlinks, rename. Where it leads is `link-resolve.ts`'s
 * (and Rust `vault.rs`'s) job; this only takes the written link apart.
 */

export interface NoteLink {
  /** `[[...]]` (a name looked up in the vault), else a Markdown link's path. */
  wiki: boolean;
  /** `![[...]]`. */
  embed: boolean;
  /** The note or file as written, decoded; empty for this document. */
  note: string;
  /** The heading levels of `#A#B`, outermost first; the last is the target. */
  headings: string[];
  /** A `#^id` block, without the "^": never taken for a heading. */
  block: string | null;
  /** The text after "|"; null when none or empty (`[[Note|]]`). */
  alias: string | null;
}

const WIKI = /^(!?)\[\[([^[\]\n]+)\]\]$/;

/** A whole `[[link]]` as written, for finding links in text: no newline or
 *  "[" inside, and not `[[x]](url)`. Put "!" before it for an embed. */
export const WIKILINK_SOURCE = String.raw`\[\[[^[\]\n]+\]\](?!\()`;

function decode(text: string, whole: boolean): string {
  try {
    return whole ? decodeURIComponent(text) : decodeURI(text);
  } catch {
    return text;
  }
}

/** `#A#B` or `#^id` split into heading levels and a block id. */
function anchorParts(anchor: string): Pick<NoteLink, "headings" | "block"> {
  const levels = anchor
    .split("#")
    .map((part) => part.trim())
    .filter(Boolean);
  const last = levels.at(-1);
  if (last?.startsWith("^"))
    return { headings: levels.slice(0, -1), block: last.slice(1) || null };
  return { headings: levels, block: null };
}

/**
 * A link as written - `[[Note#^id|alias]]`, `![[Note#Heading]]`, `[[#^id]]`,
 * or a Markdown link's target (`Note.md#my-heading`, `<My Note.md>`,
 * `../a/Note`) - taken apart; null for a web URL or nothing at all.
 */
export function parseNoteLink(written: string): NoteLink | null {
  const text = written.trim();
  const wiki = WIKI.exec(text);
  if (wiki) {
    // In a table the bar is written `\|`; the backslash isn't the name's.
    const bar = /\\?\|/.exec(wiki[2]);
    const target = bar ? wiki[2].slice(0, bar.index) : wiki[2];
    const alias = bar ? wiki[2].slice(bar.index + bar[0].length).trim() : "";
    const hash = target.indexOf("#");
    const note = (hash < 0 ? target : target.slice(0, hash)).trim();
    const parts = anchorParts(hash < 0 ? "" : target.slice(hash + 1));
    if (!note && !parts.headings.length && !parts.block) return null;
    return {
      wiki: true,
      embed: wiki[1] === "!",
      note,
      ...parts,
      alias: alias || null,
    };
  }
  if (/^!?\[\[/.test(text)) return null;
  const bare =
    text.startsWith("<") && text.endsWith(">") ? text.slice(1, -1) : text;
  if (!bare || (!isDrivePath(bare) && hasUrlScheme(bare))) return null;
  const hash = bare.indexOf("#");
  const note = decode(hash < 0 ? bare : bare.slice(0, hash), false);
  const parts = anchorParts(hash < 0 ? "" : decode(bare.slice(hash + 1), true));
  if (!note && !parts.headings.length && !parts.block) return null;
  return { wiki: false, embed: false, note, ...parts, alias: null };
}

/**
 * The file names a link's note may be, in the order they are tried: a
 * Markdown note first (`[[Note v1.2]]` is `Note v1.2.md`, not a ".2" file),
 * then the name as written (`[[file.pdf]]`).
 */
export function noteFileNames(note: string): string[] {
  return isNoteFile(note) ? [note] : [`${note}.md`, `${note}.markdown`, note];
}
