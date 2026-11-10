import { useSyncExternalStore } from "react";
import { useSettings } from "../../../prefs/SettingsContext";
import { DRAFT, conversationScope } from "../conversation-scope";
import { conversationFor } from "../conversation/conversation-registry";
import {
  attachedDocument,
  onAttachedDocument,
} from "../conversation/document-port";
import { useLiveConversationId } from "../conversation/useConversation";
import { ConversationPanel } from "./ConversationPanel";

export { stopConversations } from "../conversation/conversation-model";

/**
 * One of the window's conversations, drawn from its own model: an AI tab's
 * (`conversation`), or with none given the live one where the document in
 * front is (the iPad's panel). It keeps its turns whatever document comes
 * and goes.
 */
export function WindowConversation({
  conversation = DRAFT,
}: {
  conversation?: string;
}) {
  const document = useSyncExternalStore(onAttachedDocument, attachedDocument);
  const { settings } = useSettings();
  const scope = conversationScope(
    document?.port.docPath ?? null,
    settings.agentWorkspaceRoot || null,
  );
  const live = useLiveConversationId(scope);
  // A draft just sent is its scope's live one before its tab says so.
  const id = conversation === DRAFT ? (live ?? DRAFT) : conversation;
  const model = conversationFor(id, scope);
  return (
    <ConversationPanel key={model.key} model={model} document={document} />
  );
}
