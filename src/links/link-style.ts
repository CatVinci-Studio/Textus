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

/** The link style of the folder holding the document `path` (the core keeps
 *  each folder's answer a moment). */
export function linkStyleAt(path: string): Promise<LinkStyle> {
  return fs
    .folderConventions(path)
    .then(folderLinkStyle, () => DEFAULT_LINK_STYLE);
}
