import { useSettings } from "../settings/SettingsContext";
import { localeOf } from "../i18n/strings";
import {
  useChatHistory,
  useHasArchivedConversations,
  deleteConversation,
} from "../ai/chat/chat-history";
import { reopenConversation } from "./reopen-conversation";
import { CloseIcon } from "../ui/icons";
import { basename, dirname } from "../utils/path";
import type { ChatSummary } from "../ai/chat/chat-history";

/** Conversations by the folder their document lives in - the project they
 *  belong to - most recently active group first. Unsaved drafts form one
 *  group of their own. */
export function groupByProject(
  entries: ChatSummary[],
): { folder: string | null; entries: ChatSummary[] }[] {
  const groups = new Map<string | null, ChatSummary[]>();
  for (const entry of [...entries].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const folder = entry.docPath ? dirname(entry.docPath) : null;
    groups.set(folder, [...(groups.get(folder) ?? []), entry]);
  }
  return [...groups].map(([folder, list]) => ({ folder, entries: list }));
}

/**
 * Sidebar panel over the saved agent conversations (see ai/chat/chat-history.ts),
 * grouped by project folder. Clicking an entry reopens it with its document
 * as the live conversation in the Agent panel (reopen-conversation.ts).
 */
export function ChatHistory() {
  const { t, settings } = useSettings();
  const entries = useChatHistory();
  const archived = useHasArchivedConversations(entries);
  // In the UI's language, not the OS's: a Chinese UI on an English system
  // dated its conversations in English.
  const locale = localeOf(settings.language);

  if (entries.length === 0) {
    return <div className="clipboard-empty">{t.chatHistoryEmpty}</div>;
  }

  return (
    <div className="chat-history">
      {archived && (
        <div className="chat-history-archived">{t.chatHistoryArchived}</div>
      )}
      {groupByProject(entries).map((group) => (
        <section key={group.folder ?? ""} className="chat-history-group">
          <div className="chat-history-group-title" title={group.folder ?? ""}>
            {group.folder
              ? basename(group.folder) || group.folder
              : t.chatHistoryUnsaved}
          </div>
          {group.entries.map((entry) => (
            <div
              key={entry.id}
              className="chat-history-entry"
              title={
                entry.docPath
                  ? t.chatHistoryRestoreHint
                  : t.chatHistoryRestoreHereHint
              }
              onClick={() => void reopenConversation(entry, t)}
            >
              <div className="chat-history-entry-main">
                <span className="chat-history-entry-title">
                  {entry.title || "…"}
                </span>
                <span className="chat-history-entry-meta">
                  {new Date(entry.updatedAt).toLocaleString(locale)}
                  {entry.docPath ? ` · ${basename(entry.docPath)}` : ""}
                </span>
              </div>
              <button
                className="chat-history-entry-delete"
                title={t.chatHistoryDelete}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteConversation(entry.id);
                }}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
