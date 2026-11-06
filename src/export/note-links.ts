import { fs } from "../platform/ipc";
import { windowFolder } from "../platform/window-folder";
import { parseNoteLink } from "../utils/note-link";
import { parseEmbed } from "../editor/images/obsidian-embed";
import { exportSrc } from "../editor/images/obsidian-embed-preview";

/** Where an exported `[[link]]` or `![[embed]]` leads: a picture's file to
 *  put in, or a note's href; null keeps it as its text. */
export type NoteLinkOut =
  { image: string; width: number | null; alt: string } | { href: string };

// Same as the editor's tokenizers: no newline or "[" inside, not `[[x]](url)`.
const WIKILINK = /!?\[\[[^[\]\n]+\]\](?!\()/g;

/** Every `[[link]]` and `![[embed]]` written in `markdown`. */
export function noteLinkSources(markdown: string): string[] {
  return [...new Set(markdown.match(WIKILINK) ?? [])];
}

/**
 * Where each source leads, found as a click finds it, from the document at
 * `docPath`. A note's href is written from the folder of `from` (the file
 * the link will sit in): relative inside it, else the full path.
 */
export async function resolveNoteLinks(
  sources: readonly string[],
  docPath: string | null,
  from: string,
): Promise<Map<string, NoteLinkOut | null>> {
  const found = new Map<string, NoteLinkOut | null>();
  if (!docPath) return found;
  const folder = windowFolder();
  await Promise.all(
    sources.map(async (source) => {
      const embed = parseEmbed(source);
      const link = parseNoteLink(source);
      let out: NoteLinkOut | null = null;
      try {
        if (embed?.isImage) {
          const file = await fs.resolveVaultImage(docPath, embed.path, folder);
          if (file) out = { image: file, width: embed.width, alt: embed.alt };
        } else if (link?.note) {
          const target = await fs.resolveNoteLink(
            docPath,
            link.note,
            folder,
            true,
          );
          if (target?.exists) out = { href: exportSrc(target.path, from) };
        }
      } catch {
        // Unresolved: exported as its text.
      }
      found.set(source, out);
    }),
  );
  return found;
}
