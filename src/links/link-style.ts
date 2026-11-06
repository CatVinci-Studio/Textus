import { fs } from "../platform/ipc";
import type { Conventions } from "../platform/ipc-files";
import { DEFAULT_LINK_STYLE, type LinkStyle } from "./link-resolve";

/** How links are written where `conventions` hold; Textus's own where no
 *  app says. */
export function folderLinkStyle(conventions: Conventions | null): LinkStyle {
  const style = conventions?.linkStyle?.value;
  if (!style) return DEFAULT_LINK_STYLE;
  const path = conventions?.linkPath?.value;
  return {
    wiki: style === "wiki",
    format: path === "relative" || path === "absolute" ? path : "shortest",
  };
}

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

/** The link style of the folder holding the document `path` (the core keeps
 *  each folder's answer a moment). */
export function linkStyleAt(path: string): Promise<LinkStyle> {
  return fs
    .folderConventions(path)
    .then(folderLinkStyle, () => DEFAULT_LINK_STYLE);
}
