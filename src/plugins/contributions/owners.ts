import { getUiState, setUiState } from "../../storage/ui-state";
import { logPluginMessage } from "../store/plugin-log";
import type { PluginManifest } from "../store/manifest";

/**
 * What only one plugin may do at a time - draw a code block language
 * ("codeBlock:chart"), give a kind of hover card ("hover:link"), open a
 * file pattern ("editor:*.pdf"), give an embed kind ("embed:note") - and
 * who does it now: the user's pick, else the plugin that claimed it first.
 * When the owner goes, the next claimant takes over at once.
 */

const claimants = new Map<string, string[]>();
const listeners = new Set<() => void>();
/** The user's picks, read once; kept here too where UI state isn't. */
let picked: Record<string, string> | null = null;

function picks(): Record<string, string> {
  if (picked) return picked;
  const saved = getUiState("pluginOwners");
  picked =
    saved && typeof saved === "object" ? (saved as Record<string, string>) : {};
  return picked;
}

function changed() {
  for (const listener of listeners) listener();
}

/** The plugin that does `claim` now, if any is on. */
export function ownerOf(claim: string): string | null {
  const list = claimants.get(claim);
  if (!list?.length) return null;
  const pick = picks()[claim];
  return pick && list.includes(pick) ? pick : list[0];
}

/** Every plugin on that claims `claim`, the earliest first. */
export function claimantsOf(claim: string): readonly string[] {
  return claimants.get(claim) ?? [];
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

/** The user's choice of who does `claim`, kept across restarts. */
export function pickOwner(claim: string, plugin: string): void {
  picked = { ...picks(), [claim]: plugin };
  setUiState("pluginOwners", picked);
  changed();
}

export function onOwnersChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The claims a manifest makes besides its code blocks: the file patterns
 *  it opens by default, and the hover cards it declares (1.3.9). */
export function ownedClaims(
  contributes: PluginManifest["contributes"],
): string[] {
  const hovers = (contributes as { hovers?: readonly string[] }).hovers ?? [];
  return [
    ...contributes.customEditors
      .filter((editor) => editor.priority === "default")
      .flatMap((editor) => editor.filenamePatterns)
      .map((pattern) => `editor:${pattern.toLowerCase()}`),
    ...hovers.map((kind) => `hover:${kind}`),
  ];
}
