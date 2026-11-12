import { logPluginMessage } from "../store/plugin-log";
import type { PluginManifest } from "../store/manifest";

/**
 * What only one plugin may do at a time - draw a code block language
 * ("codeBlock:chart"), give a kind of hover card ("hover:link"), open a
 * file pattern ("editor:*.pdf"), give an embed kind ("embed:note") - and
 * who does it now: the plugin that claimed it first.
 * When the owner goes, the next claimant takes over at once.
 */

const claimants = new Map<string, string[]>();
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

/** Each kind of claim's key: one language, file pattern, hover or embed
 *  kind. */
export const claimKey = {
  codeBlock: (language: string) => `codeBlock:${language.toLowerCase()}`,
  editor: (pattern: string) => `editor:${pattern.toLowerCase()}`,
  hover: (kind: string) => `hover:${kind}`,
  embed: (kind: string) => `embed:${kind}`,
};

/** A front matter key's place among the file patterns an editor claims. */
export const frontMatterClaim = (key: string) => `front-matter:${key}`;

/** The plugin that does `claim` now, if any is on. */
export function ownerOf(claim: string): string | null {
  return claimants.get(claim)?.[0] ?? null;
}

/** Every claim held now, by its prefix ("codeBlock:"). */
export function claimsStartingWith(prefix: string): string[] {
  return [...claimants.keys()].filter((claim) => claim.startsWith(prefix));
}

/** `plugin` claims `claim` until the returned function is called. A claim
 *  someone else holds stays theirs, and the plugin's log says so. */
export function claim(claim: string, plugin: string): () => void {
  const list = claimants.get(claim) ?? [];
  if (!list.includes(plugin)) list.push(plugin);
  claimants.set(claim, list);
  const owner = ownerOf(claim);
  if (owner && owner !== plugin) {
    logPluginMessage(plugin, "info", `${claim} is ${owner}'s.`);
  }
  changed();
  return () => {
    const now = claimants.get(claim)?.filter((id) => id !== plugin) ?? [];
    if (now.length) claimants.set(claim, now);
    else claimants.delete(claim);
    changed();
  };
}

export function onOwnersChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The claims a manifest makes besides its code blocks and embeds: the
 *  file patterns it opens by default, and the hover cards it declares. */
export function ownedClaims(
  contributes: PluginManifest["contributes"],
): string[] {
  return [
    ...contributes.customEditors
      .filter((editor) => editor.priority === "default")
      .flatMap((editor) => [
        ...editor.filenamePatterns,
        ...editor.frontMatter.map(frontMatterClaim),
      ])
      .map(claimKey.editor),
    ...contributes.hovers.map(claimKey.hover),
  ];
}
