import { getUiState, setUiState } from "../../storage/ui-state";
import { loadSettings } from "../../prefs/settings-store";
import {
  askingValue,
  modeOption,
  readOptions,
  type AgentOption,
} from "./agent-mode";

/**
 * What each external agent offers, as last heard from it: the options it
 * can set and its slash commands, kept between launches so its menus show
 * before a session starts (a cache: the live session's replace them). The
 * user's choices are a setting (agentOptions), applied as a session opens.
 */

export interface AgentCommand {
  name: string;
  description: string;
  /** What to type after the name, if it takes anything. */
  hint?: string;
}

interface AgentOffer {
  options: AgentOption[];
  commands: AgentCommand[];
}

const NONE: AgentOffer = { options: [], commands: [] };
let offers: Map<string, AgentOffer> | null = null;
const listeners = new Set<() => void>();

function readCommands(raw: unknown): AgentCommand[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c): AgentCommand[] => {
    if (typeof c !== "object" || c === null) return [];
    const { name, description, input } = c as Record<string, unknown>;
    if (typeof name !== "string" || !name) return [];
    const hint = (input as { hint?: unknown } | null)?.hint;
    return [
      {
        name,
        description: typeof description === "string" ? description : "",
        ...(typeof hint === "string" && hint ? { hint } : {}),
      },
    ];
  });
}

function all(): Map<string, AgentOffer> {
  if (offers) return offers;
  offers = new Map();
  const saved = getUiState("agentOffers");
  if (saved && typeof saved === "object")
    for (const [agent, offer] of Object.entries(saved)) {
      const o = (offer ?? {}) as Record<string, unknown>;
      offers.set(agent, {
        options: readOptions(o.options),
        commands: readCommands(o.commands),
      });
    }
  return offers;
}

function hear(agent: string, next: Partial<AgentOffer>): void {
  const map = all();
  map.set(agent, { ...(map.get(agent) ?? NONE), ...next });
  // Kept as the agent sends them, so a read checks them the same way.
  setUiState(
    "agentOffers",
    Object.fromEntries(
      [...map].map(([key, o]) => [
        key,
        {
          options: o.options.map((x) => ({
            id: x.id,
            name: x.name,
            category: x.category,
            currentValue: x.current,
            options: x.choices,
          })),
          commands: o.commands.map((c) => ({
            ...c,
            input: c.hint ? { hint: c.hint } : null,
          })),
        },
      ]),
    ),
  );
  for (const listener of listeners) listener();
}

export const offerOf = (agent: string): AgentOffer => all().get(agent) ?? NONE;

export function subscribeOffers(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Options as the agent sent them (`configOptions`), now in force. */
export function heardOptions(agent: string, raw: unknown): AgentOption[] {
  const options = readOptions(raw);
  hear(agent, { options });
  return options;
}

export function heardCommands(agent: string, raw: unknown): void {
  hear(agent, { commands: readCommands(raw) });
}

/** One option set to `value`, as the agent confirmed. */
export function heardValue(agent: string, id: string, value: string): void {
  hear(agent, {
    options: offerOf(agent).options.map((o) =>
      o.id === id ? { ...o, current: value } : o,
    ),
  });
}

const chosenFor = (agent: string): Record<string, string> =>
  loadSettings().agentOptions[agent] ?? {};

/** The value `option` should have: the user's choice while the agent still
 *  offers it, else, for the mode, the one that asks first. */
export function wanted(
  option: AgentOption,
  options: readonly AgentOption[],
  chosen: Record<string, string>,
): string | null {
  const choice = chosen[option.id];
  if (choice !== undefined && option.choices.some((c) => c.value === choice))
    return choice;
  return option.category === "mode" || option.id === "mode"
    ? askingValue(options)
    : null;
}

/** The options whose value in force isn't the one wanted, with it. */
export function choicesToSend(agent: string): [string, string][] {
  const { options } = offerOf(agent);
  const chosen = chosenFor(agent);
  return options.flatMap((o): [string, string][] => {
    const value = wanted(o, options, chosen);
    return value !== null && value !== o.current ? [[o.id, value]] : [];
  });
}

/**
 * Sets each option the user chose, and the mode that asks unless another
 * was chosen, in the order the agent lists them: an option may depend on
 * the one before (Claude Code's effort on its model), so the agent's
 * answer to each is read before the next.
 */
export async function applyChoices(
  agent: string,
  raw: unknown,
  set: (configId: string, value: string) => Promise<unknown>,
): Promise<void> {
  let options = heardOptions(agent, raw);
  const done = new Set<string>();
  for (;;) {
    const chosen = chosenFor(agent);
    const next = options.find((o) => {
      if (done.has(o.id)) return false;
      const value = wanted(o, options, chosen);
      return value !== null && value !== o.current;
    });
    if (!next) return;
    done.add(next.id);
    const value = wanted(next, options, chosen)!;
    // A model or effort the agent turns down is skipped; the mode isn't:
    // the session never runs in one that doesn't ask unless chosen.
    const isMode = next.id === modeOption(options)?.id;
    let answer: { configOptions?: unknown } | null;
    try {
      answer = (await set(next.id, value)) as typeof answer;
    } catch (err) {
      if (isMode) throw err;
      continue;
    }
    if (answer?.configOptions)
      options = heardOptions(agent, answer.configOptions);
    else {
      heardValue(agent, next.id, value);
      options = offerOf(agent).options;
    }
  }
}

/** Forgets what was heard, for tests. */
export function resetOffersForTests(): void {
  offers = null;
  listeners.clear();
}
