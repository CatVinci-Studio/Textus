/**
 * An agent's permission mode as Textus starts it: the one that asks before
 * each change. The agent's own settings may start it at "accept
 * everything" (Claude Code's bypassPermissions); in Textus every change it
 * makes goes through the permission dialog first.
 */

export interface ConfigOption {
  id: string;
  category?: string;
  type?: string;
  currentValue?: string;
  options?: { value: string; name?: string; description?: string }[];
}

/** Words an agent uses for its mode that asks first, best first. */
const ASKING = [
  /always ask/i,
  /requires approval/i,
  /\bmanual\b/i,
  /^default$/i,
];

/** The mode option and the value that asks, if the agent has one and isn't
 *  in it already. */
export function askingMode(
  options: readonly ConfigOption[] | undefined,
): { configId: string; value: string } | null {
  const mode = options?.find((o) => o.category === "mode" || o.id === "mode");
  if (!mode?.options?.length) return null;
  for (const word of ASKING) {
    const pick = mode.options.find((o) =>
      word.test(`${o.description ?? ""} ${o.name ?? ""} ${o.value}`),
    );
    if (pick)
      return pick.value === mode.currentValue
        ? null
        : { configId: mode.id, value: pick.value };
  }
  return null;
}
