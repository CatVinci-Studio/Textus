import { useCallback, useState } from "react";
import { useSettings } from "../../settings/SettingsContext";
import { localeOf } from "../../i18n/strings";
import {
  useChatHistory,
  useHasArchivedConversations,
  deleteConversation,
} from "./chat-history";
import { CloseIcon, HistoryIcon } from "../../ui/icons";
import { Presence, PresenceDiv } from "../../ui/usePresence";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";
import { basename, dirname } from "../../utils/path";
import type { ChatSummary } from "./chat-history";
import { Tooltip } from "../../ui/Tooltip";
import "./chat-history-menu.css";

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
 * The history button in a chat surface's header (the AI panel's, the
 * detached window's) and the list of saved conversations it opens
 * (ai/chat/chat-history.ts), grouped by project folder. Picking one hands
 * it to `onReopen` (reopen-conversation.ts) and closes the list. The list
 * spans the header it sits in, which is its containing block.
 */
export function ChatHistoryMenu({
  buttonClassName,
  disabled,
  onReopen,
}: {
  buttonClassName: string;
  disabled?: boolean;
  onReopen: (entry: ChatSummary) => void;
}) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useCloseOnOutsideClick<HTMLDivElement>(close, true, open);
  return (
    <div className="chat-history-anchor" ref={ref}>
      <Tooltip text={t.chatHistoryOpen}>
        <button
          type="button"
          className={buttonClassName}
          aria-label={t.chatHistoryOpen}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen(!open)}
        >
          <HistoryIcon />
        </button>
      </Tooltip>
      <Presence show={open} exitMs={120}>
        {open && (
          <PresenceDiv
            className="chat-history-menu floating-surface"
            role="dialog"
            aria-label={t.chatHistoryOpen}
          >
            <ChatHistoryList
              onReopen={(entry) => {
                close();
                onReopen(entry);
              }}
            />
          </PresenceDiv>
        )}
      </Presence>
    </div>
  );
}

function ChatHistoryList({
  onReopen,
}: {
  onReopen: (entry: ChatSummary) => void;
}) {
  const { t, settings } = useSettings();
  const entries = useChatHistory();
  const archived = useHasArchivedConversations(entries);
  // In the UI's language, not the OS's: a Chinese UI on an English system
  // dated its conversations in English.
  const locale = localeOf(settings.language);

  if (entries.length === 0) {
    return <div className="chat-history-empty">{t.chatHistoryEmpty}</div>;
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
              onClick={() => onReopen(entry)}
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
                aria-label={t.chatHistoryDelete}
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
