/**
 * What an external agent offers to set: its ACP config options (its mode,
 * model, effort), read into one shape. Textus starts an agent in the mode
 * that asks before each change unless the user chose another: the agent's
 * own settings may start it at "accept everything" (Claude Code's
 * bypassPermissions).
 */

import { isRecord } from "../../utils/is-record";

interface AgentChoice {
  value: string;
  name: string;
  description?: string;
}

export interface AgentOption {
  id: string;
  name: string;
  /** "mode", "model", "thought_level", "model_config", or none. */
  category?: string;
  current: string;
  choices: AgentChoice[];
}

const text = (v: unknown) => (typeof v === "string" ? v : undefined);

/** A list's choices, a grouped list's (DeepSeek's `{group, options}`)
 *  one after another. */
function choicesOf(raw: unknown): AgentChoice[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c): AgentChoice[] => {
    if (!isRecord(c)) return [];
    if (Array.isArray(c.options)) return choicesOf(c.options);
    const value = text(c.value);
    if (value === undefined) return [];
    return [
      { value, name: text(c.name) || value, description: text(c.description) },
    ];
  });
}

/** An agent's `configOptions` as offered: the lists to pick from. */
export function readOptions(raw: unknown): AgentOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((o): AgentOption[] => {
    if (!isRecord(o) || typeof o.id !== "string") return [];
    if (o.type !== undefined && o.type !== "select") return [];
    const choices = choicesOf(o.options);
    if (choices.length < 2) return [];
    return [
      {
        id: o.id,
        name: text(o.name) || o.id,
        category: text(o.category),
        current: text(o.currentValue) ?? "",
        choices,
      },
    ];
  });
}

/** Words an agent uses for its mode that asks first, best first. A bare
 *  "ask" is no such word: Codex's Workspace access asks only outside it. */
const ASKING = [
  /always ask/i,
  /requires approval/i,
  /\bmanual\b/i,
  /^default$/i,
];

export const modeOption = (options: readonly AgentOption[]) =>
  options.find((o) => o.category === "mode" || o.id === "mode");

/** The value of the mode that asks first, if the agent has one. */
export function askingValue(options: readonly AgentOption[]): string | null {
  const mode = modeOption(options);
  if (!mode) return null;
  for (const word of ASKING) {
    const pick = mode.choices.find((c) =>
      [c.description ?? "", c.name, c.value].some((part) => word.test(part)),
    );
    if (pick) return pick.value;
  }
  return null;
}

/** The name of the mode `value` when it doesn't ask first, for the chip to
 *  say; null when it does, or when the agent has no mode that asks (its
 *  own mode is then just how it works, as OpenCode's build). */
export function unaskingName(
  options: readonly AgentOption[],
  value: string | undefined,
): string | null {
  const mode = modeOption(options);
  const asking = askingValue(options);
  if (!mode || asking === null || value === asking) return null;
  return mode.choices.find((c) => c.value === value)?.name ?? null;
}
