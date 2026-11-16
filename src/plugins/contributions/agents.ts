import { useSyncExternalStore } from "react";
import { createSubscribers } from "../../utils/store";

/**
 * The AI agents on this computer that on plugins name (`contributes.agents`)
 * and were granted `agents` for: what Textus AI's model menu offers beside
 * the models. Gone with the plugin.
 */

export interface ExternalAgent {
  /** "<plugin>/<agent id>": what the chat remembers it by. */
  key: string;
  plugin: string;
  id: string;
  name: string;
  /** How to install it and sign in, for when it can't start. */
  setup?: string;
  /** The provider whose models it runs, if it says. */
  provider?: string;
  /** Its mode that asks first, as its plugin names it. */
  askMode?: string;
  /** The sign-in Textus may run for it; "" for none (manifest). */
  signIn?: string;
}

let agents: ExternalAgent[] = [];
const subscribers = createSubscribers();

function publish(next: ExternalAgent[]) {
  agents = next;
  subscribers.publish();
}

/** Adds a plugin's agents; the returned function takes them away. */
export function addAgents(
  plugin: string,
  list: Omit<ExternalAgent, "key" | "plugin">[],
): () => void {
  publish([
    ...agents.filter((a) => a.plugin !== plugin),
    ...list.map((a) => ({ ...a, plugin, key: `${plugin}/${a.id}` })),
  ]);
  return () => publish(agents.filter((a) => a.plugin !== plugin));
}

function externalAgents(): ExternalAgent[] {
  return agents;
}

export function externalAgent(key: string | null | undefined) {
  return key ? agents.find((a) => a.key === key) : undefined;
}

const subscribe = subscribers.subscribe;

export function useExternalAgents(): ExternalAgent[] {
  return useSyncExternalStore(subscribe, externalAgents);
}
