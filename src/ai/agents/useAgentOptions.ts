import { useSyncExternalStore } from "react";
import { useSettings, useSettingsIfAny } from "../../prefs/SettingsContext";
import { askingValue, modeOption, type AgentOption } from "./agent-mode";
import {
  offerOf,
  subscribeOffers,
  wanted,
  type AgentCommand,
} from "./agent-offers";
import { externalAgent } from "../../plugins/contributions/agents";
import { setAgentOption } from "./agent-exchange";

/** An agent's options as its menu shows them: each with the value in
 *  force, the user's choice or, for the mode, the one that asks. */
export interface AgentOptionsMenu {
  options: (AgentOption & { value: string })[];
  choose(id: string, value: string): void;
  /** The mode's name while it isn't the one that asks first. */
  unasking: string | null;
}

export function useAgentOptions(agent: string | null): AgentOptionsMenu | null {
  const { settings, setSettings } = useSettings();
  const offer = useSyncExternalStore(subscribeOffers, () =>
    offerOf(agent ?? ""),
  );
  if (!agent || offer.options.length === 0) return null;
  const chosen = settings.agentOptions[agent] ?? {};
  const options = offer.options.map((o) => ({
    ...o,
    value: wanted(o, offer.options, chosen) ?? o.current,
  }));
  const mode = modeOption(options);
  const modeValue = mode && options.find((o) => o.id === mode.id)?.value;
  const asking = askingValue(offer.options);
  return {
    options,
    choose: (id, value) => {
      setSettings({
        agentOptions: {
          ...settings.agentOptions,
          [agent]: { ...chosen, [id]: value },
        },
      });
      setAgentOption(agent, id, value);
    },
    unasking:
      mode && modeValue !== asking
        ? (mode.choices.find((c) => c.value === modeValue)?.name ?? null)
        : null,
  };
}

/** The agent the chat talks to and its slash commands, while `answers`
 *  (it answers this composer); null when Textus AI does. */
export function useAgentCommands(
  answers: boolean,
): { name: string; commands: AgentCommand[] } | null {
  const chatAgent = useSettingsIfAny()?.settings.chatAgent;
  const agent = answers ? externalAgent(chatAgent) : undefined;
  const offer = useSyncExternalStore(subscribeOffers, () =>
    offerOf(agent?.key ?? ""),
  );
  return agent ? { name: agent.name, commands: offer.commands } : null;
}
