import { useSyncExternalStore } from "react";
import { useWhoAnswers } from "../chat/conversation/useWhoAnswers";
import { useSettings } from "../../prefs/SettingsContext";
import { modeOption, unaskingName, type AgentOption } from "./agent-mode";
import {
  offerOf,
  subscribeOffers,
  wantedNow,
  type AgentCommand,
} from "./agent-offers";
import { externalAgent } from "../../plugins/contributions/agents";
import { currentStrings } from "../../i18n/current";
import { APPROVAL, approvalOption } from "./agent-approval";
import {
  agentRunning,
  setAgentOption,
  subscribeSessions,
} from "./agent-exchange";

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
  const running = useSyncExternalStore(subscribeSessions, () =>
    agentRunning(agent ?? ""),
  );
  if (!agent || offer.options.length === 0) return null;
  const chosen = settings.agentOptions[agent] ?? {};
  const approval = approvalOption(offer.options, currentStrings());
  const options = byKind([
    ...offer.options,
    ...(approval ? [approval] : []),
  ]).map((o) => ({
    ...o,
    value: wantedNow(agent, o, offer.options, chosen) ?? o.current,
  }));
  const mode = modeOption(options);
  const modeValue = mode && options.find((o) => o.id === mode.id)?.value;
  return {
    options,
    choose: (id, value) => {
      setSettings({
        agentOptions: {
          ...settings.agentOptions,
          [agent]: { ...chosen, [id]: value },
        },
      });
      // Textus's own switch never goes to the agent.
      if (id !== APPROVAL) setAgentOption(agent, id, value);
    },
    // While a session runs, the mode it reported: the agent may have
    // moved itself off the one chosen.
    unasking:
      unaskingName(offer.options, running ? mode?.current : modeValue) ??
      (approval && chosen[APPROVAL] === "allow"
        ? currentStrings().agentAllowAll
        : null),
  };
}

/** The menu's order: how it works (mode, approval), then what thinks
 *  (model, effort), then the rest, each kind in the agent's order. */
const KINDS = ["mode", "approval", "model", "thought_level"];
const byKind = (options: AgentOption[]) => {
  const rank = (o: AgentOption) => {
    const at = KINDS.indexOf(o.category ?? "");
    return at < 0 ? KINDS.length : at;
  };
  return options
    .map((o, i) => ({ o, i }))
    .sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i)
    .map(({ o }) => o);
};

/** The agent the chat talks to and its slash commands, while `answers`
 *  (it answers this composer); null when Textus AI does. */
export function useAgentCommands(
  answers: boolean,
): { name: string; commands: AgentCommand[] } | null {
  const { agent: chatAgent } = useWhoAnswers();
  const agent = answers ? externalAgent(chatAgent) : undefined;
  const offer = useSyncExternalStore(subscribeOffers, () =>
    offerOf(agent?.key ?? ""),
  );
  return agent ? { name: agent.name, commands: offer.commands } : null;
}
