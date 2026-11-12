import { fs } from "../platform/ipc";
import { type Conventions } from "../platform/bindings/files";
import { DEFAULT_LINK_STYLE, type LinkStyle } from "./link-resolve";

/** How links are written where `conventions` hold: the folder's own choice,
 *  else a notes app's (an Obsidian vault's); null where none says. */
export function folderLinkStyle(
  conventions: Conventions | null,
): LinkStyle | null {
  const said = conventions?.linkStyle ?? conventions?.detected?.linkStyle;
  if (!said?.value) return null;
  const path = (conventions?.linkPath ?? conventions?.detected?.linkPath)
    ?.value;
  return {
    wiki: said.value === "wiki",
    format: path === "relative" || path === "absolute" ? path : "shortest",
  };
}

const WIKI_LINK = /\[\[[^\]\n]+\]\]/g;
// A link, not a picture: `![alt](x.png)` says nothing about how notes link.
const NOTE_LINK = /(?<!!\[[^\]\n]*)\]\((?![a-z][a-z0-9+.-]*:|#)[^)\s]+\)/gi;

/** The way `text` already links to notes, by count; null for neither. */
export function linkStyleIn(text: string): LinkStyle | null {
  const wiki = text.match(WIKI_LINK)?.length ?? 0;
  const markdown = text.match(NOTE_LINK)?.length ?? 0;
  if (wiki === markdown) return null;
  return wiki > markdown ? WIKI_LINKS : DEFAULT_LINK_STYLE;
}

/** Obsidian's way, for a note that already links so. */
const WIKI_LINKS: LinkStyle = { wiki: true, format: "shortest" };

const NOTE_APPS = new Set(["obsidian", "logseq", "dendron", "foam"]);

/** The folder links by name are found in: the nearest notes app's, whether
 *  or not its settings were taken (it only says where links are). */
export function notesRoot(conventions: Conventions | null): string | null {
  return (
    conventions?.sources.find((s) => NOTE_APPS.has(s.app))?.root ??
    conventions?.linkStyle?.root ??
    null
  );
}

/** What a rename does to the links naming the file: the project's setting,
 *  else the notes app's ("always" in an Obsidian vault by default), else
 *  ask. */
export function renameRule(
  conventions: Conventions | null,
): "always" | "ask" | "never" {
  const rule =
    conventions?.updateLinks?.value ??
    conventions?.detected?.updateLinks?.value;
  return rule === "always" || rule === "never" ? rule : "ask";
}

/** How a link written in the document `path` is written: as its folder
 *  says (the core keeps each folder's answer a moment), else as the note
 *  already links, so one page never mixes the two, else a standard link. */
export async function linkStyleAt(path: string): Promise<LinkStyle> {
  const said = await fs
    .folderConventions(path)
    .then(folderLinkStyle, () => null);
  if (said) return said;
  const text = await fs.readTextFile(path).catch(() => "");
  return linkStyleIn(text) ?? DEFAULT_LINK_STYLE;
}
