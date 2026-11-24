import { loadSettings } from "../../../prefs/settings-store";
import { loadConversationTurns } from "../chat-history";
import {
  DRAFT,
  liveConversation,
  onLiveConversation,
  onOpenConversations,
  openConversations,
} from "../conversation-scope";
import { ConversationModel } from "./conversation-model";
import type { ConversationEnv } from "./conversation-types";
import { attachedDocument } from "./document-port";
import { aiRoot } from "../../../ai/workspace/ai-root";
import { subscribeSplit, windowTabs } from "../../../engine/layout/store";

/**
 * The window's conversations, one model each, whatever draws them: an AI
 * tab its own, the document in front its scope's live one. They outlive
 * every editor; one goes when its tab is closed.
 */
const models: ConversationModel[] = [];
/** The one not yet sent in any scope. */
let draft: ConversationModel | null = null;
let watching = false;
/** Conversations with no scope an AI tab has shown: one goes once none
 *  does. Not before, as a restored one's tab comes after it. */
const tabbed = new WeakSet<ConversationModel>();

/** The conversations the window's AI tabs show. */
function inAiTabs(): Set<string> {
  const ids = new Set<string>();
  for (const tab of windowTabs()) {
    const view = tab.view as { view?: string; state?: unknown } | undefined;
    const id = (view?.state as { conversation?: string } | undefined)
      ?.conversation;
    if (view?.view === "ai" && id) ids.add(id);
  }
  return ids;
}

/** The window as a conversation finds it: the document in front, if any,
 *  and the settings as they are now. */
function windowEnv(): ConversationEnv {
  const settings = loadSettings();
  const port = attachedDocument()?.port ?? null;
  return {
    docPath: port?.docPath ?? null,
    workspaceRoot: aiRoot(settings),
    settings,
    port,
  };
}

/**
 * The model of conversation `id` in `scope`, read from History the first
 * time; `DRAFT` is the window's conversation not yet sent anywhere.
 */
export function conversationFor(
  id: string,
  scope: string | null,
): ConversationModel {
  watch();
  if (id === DRAFT) {
    if (draft?.scope !== null) draft = create();
    return draft;
  }
  const found = models.find((model) => model.id === id);
  const model = found ?? create(id);
  model.scope ??= scope;
  if (!found)
    void loadConversationTurns(id)
      .catch(() => null)
      .then((turns) => model.adopt(id, turns ?? []));
  return model;
}

function create(id?: string): ConversationModel {
  const model = new ConversationModel({
    env: windowEnv,
    id,
    onIdentity: dropTwins,
  });
  models.push(model);
  return model;
}

function drop(model: ConversationModel) {
  if (draft === model) draft = null;
  models.splice(models.indexOf(model), 1);
  model.dispose();
}

/** `model` became a conversation another model held: that one gives way. */
function dropTwins(model: ConversationModel) {
  for (const other of [...models])
    if (other !== model && other.id === model.id) drop(other);
}

/** A conversation whose tab was closed, here or in another window, ends;
 *  one with no scope, kept nowhere else, once this window's tab goes. */
function watch() {
  if (watching) return;
  watching = true;
  const closed = () => {
    for (const model of [...models]) {
      const { scope, id } = model;
      if (!scope) continue;
      if (openConversations(scope).includes(id)) continue;
      if (liveConversation(scope) !== id) drop(model);
    }
  };
  const untabbed = () => {
    const shown = inAiTabs();
    for (const model of [...models]) {
      if (model.scope || model === draft) continue;
      if (shown.has(model.id)) tabbed.add(model);
      else if (tabbed.has(model)) drop(model);
    }
  };
  onOpenConversations(closed);
  onLiveConversation(closed);
  subscribeSplit(untabbed);
}

/** Conversation `id`, restored for a tab that never came: it goes. */
export function forgetConversation(id: string): void {
  const model = models.find((m) => m.id === id && m !== draft);
  if (model) drop(model);
}

/** Forgets every conversation, for tests. */
export function resetConversationsForTests(): void {
  for (const model of [...models]) drop(model);
}
