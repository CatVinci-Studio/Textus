import { fs } from "../platform/ipc";
import type { ObsidianVault } from "../platform/ipc-files";
import { dirname } from "../utils/path";
import { DEFAULT_LINK_STYLE, type LinkStyle } from "./link-resolve";

/** How links are written in a document of `vault`; Textus's own outside one. */
export function vaultLinkStyle(vault: ObsidianVault | null): LinkStyle {
  if (!vault) return DEFAULT_LINK_STYLE;
  const format = vault.newLinkFormat;
  return {
    wiki: !vault.useMarkdownLinks,
    format:
      format === "relative" || format === "absolute" ? format : "shortest",
  };
}

/** A vault's settings change rarely: read again after this. */
const FRESH_MS = 10_000;
const styles = new Map<string, { at: number; style: Promise<LinkStyle> }>();

/** The link style of the folder holding the document `path`. */
export function linkStyleAt(path: string): Promise<LinkStyle> {
  const dir = dirname(path);
  const known = styles.get(dir);
  if (known && Date.now() - known.at < FRESH_MS) return known.style;
  const style = fs
    .obsidianVault(path)
    .then(vaultLinkStyle, () => DEFAULT_LINK_STYLE);
  styles.set(dir, { at: Date.now(), style });
  return style;
}
