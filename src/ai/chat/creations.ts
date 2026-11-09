import type { Creation, CreationKind } from "../../prefs/settings-values";

/**
 * What Create made, across the three stores it installs into: plugins,
 * user themes and global skills each keep their own files, and the
 * settings' `creations` only remembers which entries came from a reply's
 * card, so Settings can say "Made with Textus AI".
 */

/** `list` with `made` first, over an earlier entry for the same thing. */
export function withCreation(list: Creation[], made: Creation): Creation[] {
  return [made, ...withoutCreation(list, made.kind, made.id)];
}

/** Whether Create made `id` (a plugin, theme or skill). */
export function madeByAi(
  list: Creation[],
  kind: CreationKind,
  id: string,
): boolean {
  return list.some((c) => c.kind === kind && c.id === id);
}

export function withoutCreation(
  list: Creation[],
  kind: CreationKind,
  id: string,
): Creation[] {
  return list.filter((c) => !(c.kind === kind && c.id === id));
}
