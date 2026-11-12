import { ai } from "../../../platform/ipc";
import type { AgentTurn } from "../../types";
import { conversationTitle } from "../chat-history";
import {
  insertTurns,
  memoryTurns,
  passExchange,
  skillOfferTurns,
} from "../memory-pass";
import type { ConversationModel } from "./conversation-model";
import type { ConversationEnv } from "./conversation-types";
import { chosenModel } from "../../chosen-model";

const modelInUse = ({ settings }: ConversationEnv) => ({
  provider: settings.aiProvider,
  model: chosenModel(settings),
});

/** After an exchange, what is remembered is brought up to date, each
 *  change a chip right after the exchange (`at`). A failure is silent. */
export async function rememberAfter(
  model: ConversationModel,
  env: ConversationEnv,
  conversation: AgentTurn[],
  at: number,
) {
  if (!env.settings.rememberAutomatically) return;
  const generation = model.generation;
  try {
    const changes = await ai.memoryPass({
      ...modelInUse(env),
      docPath: env.docPath,
      workspaceRoot: env.workspaceRoot,
      conversation: {
        id: model.id,
        title: conversationTitle(conversation),
      },
      exchange: passExchange(conversation),
    });
    if (changes.length === 0 || generation !== model.generation) return;
    const turns = memoryTurns(changes, () => crypto.randomUUID());
    model.setHistory((prev) => insertTurns(prev, at, turns));
  } catch {
    // Nothing remembered; the exchange itself is unaffected.
  }
}

/** After an exchange, its request offered as a skill when it was a
 *  procedure worth keeping, under the reply. */
export async function offerSkillAfter(
  model: ConversationModel,
  env: ConversationEnv,
  conversation: AgentTurn[],
  at: number,
) {
  const generation = model.generation;
  try {
    const offer = await ai.offerSkill({
      ...modelInUse(env),
      docPath: env.docPath,
      workspaceRoot: env.workspaceRoot,
      exchange: passExchange(conversation),
    });
    if (!offer || generation !== model.generation) return;
    const turns = skillOfferTurns(offer, () => crypto.randomUUID());
    model.setHistory((prev) => insertTurns(prev, at, turns));
  } catch {
    // No offer; the exchange itself is unaffected.
  }
}
