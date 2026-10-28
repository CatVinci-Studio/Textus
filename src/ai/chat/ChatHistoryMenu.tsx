import { useCallback, useState } from "react";
import { useSettings } from "../../prefs/SettingsContext";
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
import { useHistorySearch, type HistoryHit } from "./useHistorySearch";
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
 * The history button in a chat header and the saved conversations it opens,
 * grouped by project folder. Picking one hands it to `onReopen`.
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
  // In the UI's language, not the OS's.
  const locale = localeOf(settings.language);
  const [query, setQuery] = useState("");
  const hits = useHistorySearch(query);

  if (entries.length === 0) {
    return <div className="chat-history-empty">{t.chatHistoryEmpty}</div>;
  }

  const search = (
    <input
      className="chat-history-search"
      type="search"
      placeholder={t.chatHistorySearch}
      aria-label={t.chatHistorySearch}
      value={query}
      autoFocus
      spellCheck={false}
      onChange={(e) => setQuery(e.target.value)}
    />
  );
  if (query.trim())
    return (
      <div className="chat-history">
        {search}
        <SearchHits
          hits={hits}
          locale={locale}
          onReopen={(hit) => {
            const entry = entries.find((e) => e.id === hit.id);
            if (entry) onReopen(entry);
          }}
        />
      </div>
    );

  return (
    <div className="chat-history">
      {search}
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
              <Tooltip text={t.chatHistoryDelete}>
                <button
                  className="chat-history-entry-delete"
                  aria-label={t.chatHistoryDelete}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(entry.id);
                  }}
                >
                  <CloseIcon />
                </button>
              </Tooltip>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** What a search found: each conversation's title, where in it the words
 *  are, and when it was. */
function SearchHits({
  hits,
  locale,
  onReopen,
}: {
  hits: HistoryHit[] | null;
  locale: string;
  onReopen: (hit: HistoryHit) => void;
}) {
  const { t } = useSettings();
  if (hits === null) return null;
  if (hits.length === 0)
    return <div className="chat-history-empty">{t.chatHistorySearchNone}</div>;
  return (
    <section className="chat-history-group">
      {hits.map((hit) => (
        <div
          key={hit.id}
          className="chat-history-entry"
          onClick={() => onReopen(hit)}
        >
          <div className="chat-history-entry-main">
            <span className="chat-history-entry-title">{hit.title || "…"}</span>
            <span className="chat-history-hit">
              {hit.role === "user" ? t.chatHistoryByYou : t.chatHistoryByAi}:{" "}
              {hit.snippet}
            </span>
            <span className="chat-history-entry-meta">
              {new Date(hit.updatedAt).toLocaleString(locale)}
              {hit.docPath ? ` · ${basename(hit.docPath)}` : ""}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}
