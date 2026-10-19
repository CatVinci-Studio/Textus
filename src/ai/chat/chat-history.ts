import { useEffect, useMemo, useState } from "react";
import type { AgentTurn } from "../types";
import { userMessageBody } from "./user-message";
import { loadSettings } from "../../settings/SettingsContext";
import { createPersistedList } from "../../storage/persisted-list";
import { CHAT_HISTORY_KEY } from "../../storage/legacy-import";
import { readBoot } from "../../storage/boot";
import { trackWrite } from "../../storage/pending-writes";
import { storage } from "../../platform/ipc";
import { isIOSApp } from "../../platform/capabilities";
import {
  documentsDir,
  knownDocumentsDir,
  resolvedDocumentPath,
  storedDocumentPath,
} from "../../platform/documents-path";

/**
 * Persisted agent conversations, so past chats can be reopened and continued
 * (ChatHistoryMenu, in the AI panel's header). Kept by Rust, one file per conversation plus an
 * index of them (src-tauri/src/settings/chat_history.rs), and capped: beyond
 * the cap the oldest move to the folder's trash. A persisted list
 * (storage/persisted-list.ts) of the index, so the history list re-renders
 * live as conversations are saved or deleted, in every window; a
 * conversation's turns are read from its file when it is reopened.
 */
export interface ChatSummary {
  id: string;
  /** The document the conversation happened in, for the list's context line
   *  and its project group. On iOS one in the app's Documents folder is
   *  stored relative to it ("documents:...", platform/documents-path.ts) -
   *  the folder moves with every reinstall and update - and handed out
   *  resolved again by useChatHistory. */
  docPath: string | null;
  /** First user message, cleaned and truncated - the list's display name. */
  title: string;
  updatedAt: number;
  /** In the index (`summary` in chat_history.rs, which this mirrors); not
   *  in the browser fallback, whose list holds whole conversations. */
  turnCount?: number;
}

/** A whole conversation, as saved. */
export interface ChatHistoryEntry extends ChatSummary {
  turns: AgentTurn[];
}

/** chat_history.rs's MAX_CONVERSATIONS. */
const MAX_ENTRIES = 500;
const MAX_TITLE_CHARS = 60;

const history = createPersistedList<ChatSummary, ChatHistoryEntry>(
  CHAT_HISTORY_KEY,
  {
    kind: "chat",
    max: MAX_ENTRIES,
    keyOf: (entry) => entry.id,
    isEntry: (e): e is ChatSummary => {
      const entry = e as ChatSummary;
      return (
        typeof entry?.id === "string" && typeof entry.updatedAt === "number"
      );
    },
    sort: (a, b) => b.updatedAt - a.updatedAt,
    // iOS: the document path relative to Documents, on every save - and for
    // what an earlier version stored absolute, rewritten once when the list
    // loads, so its conversations join their documents' group again.
    normalise: isIOSApp ? storedEntry : undefined,
    listed: ({ turns, ...summary }) => ({
      ...summary,
      turnCount: turns.length,
    }),
    // The list holds summaries, which aren't whole conversations to save:
    // the conversations move with their document instead.
    rewrite: (stored, normalised) =>
      storage.chatHistoryMoveDocument(stored.docPath!, normalised.docPath!),
  },
);

/** `entry` with its document path in the stored form (see docPath). */
export function storedEntry<E extends ChatSummary>(entry: E): E {
  if (!entry.docPath) return entry;
  const docPath = storedDocumentPath(entry.docPath, knownDocumentsDir());
  return docPath === entry.docPath ? entry : { ...entry, docPath };
}

/** `entry` with a stored document path resolved against Documents `docs`. */
export function resolvedEntry(entry: ChatSummary, docs: string): ChatSummary {
  if (!entry.docPath) return entry;
  const docPath = resolvedDocumentPath(entry.docPath, docs);
  return docPath === entry.docPath ? entry : { ...entry, docPath };
}

// Asked early, so a save can tell the Documents folder from a path that
// merely looks like one, and the list rarely renders before it is known.
if (isIOSApp) void documentsDir().catch(() => {});

/** iOS: the Documents folder, once known; always null elsewhere. */
function useDocumentsDir(): string | null {
  const [docs, setDocs] = useState(knownDocumentsDir);
  useEffect(() => {
    if (!isIOSApp || docs) return;
    let live = true;
    documentsDir()
      .then((dir) => {
        if (live) setDocs(dir);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [docs]);
  return docs;
}

/** Reactive view of the saved conversations, most recently active first,
 *  with their document paths as the rest of the app knows them. */
export function useChatHistory(): ChatSummary[] {
  const entries = history.useEntries();
  const docs = useDocumentsDir();
  return useMemo(
    () =>
      isIOSApp && docs
        ? entries.map((entry) => resolvedEntry(entry, docs))
        : entries,
    [entries, docs],
  );
}

/** Whether conversations beyond the cap have been moved to the trash -
 *  asked again whenever the list changes. */
export function useHasArchivedConversations(entries: ChatSummary[]): boolean {
  const [archived, setArchived] = useState(false);
  useEffect(() => {
    if (!readBoot()) return;
    let live = true;
    storage
      .chatHistoryArchived()
      .then((count) => {
        if (live) setArchived(count > 0);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [entries]);
  return archived;
}

/** A saved conversation's turns, read from its file; null when it is gone.
 *  Rejects when Rust couldn't be asked. */
export async function loadConversationTurns(
  id: string,
): Promise<AgentTurn[] | null> {
  const entry = (
    readBoot()
      ? await storage.chatHistoryGet(id)
      : history.get().find((e) => e.id === id)
  ) as Partial<ChatHistoryEntry> | null | undefined;
  return Array.isArray(entry?.turns) ? entry.turns : null;
}

/** Inserts or updates one conversation, moving the stalest beyond the cap
 *  to the trash. A no-op while Settings > Privacy > Chat History is off. */
export function saveConversation(entry: ChatHistoryEntry) {
  if (!loadSettings().enableChatHistory) return;
  history.upsert(entry);
}

/** A document Textus saved under a new path (Save As, a rename) takes its
 *  conversations along, so they reopen with it. */
export function moveConversations(from: string, to: string) {
  if (from === to || !readBoot()) return;
  const stored = (path: string) =>
    isIOSApp ? storedDocumentPath(path, knownDocumentsDir()) : path;
  trackWrite(storage.chatHistoryMoveDocument(stored(from), stored(to))).catch(
    () => {},
  );
}

export function deleteConversation(id: string) {
  history.remove(id);
}

export function clearAllConversations() {
  history.clear();
}

/**
 * A display title from the first user turn: the outgoing message carries
 * context wrappers (<selected-text>, <attached-file>) that would drown out
 * what the user actually asked.
 */
export function conversationTitle(turns: AgentTurn[]): string {
  const first = turns.find((t) => t.kind === "User");
  if (!first || first.kind !== "User") return "";
  // The context blocks are stripped by the one module that owns their
  // format (user-message.ts), not by a third copy of the regexes.
  const cleaned = userMessageBody(first.text)
    .replace(/\(If this asks you to rewrite[\s\S]*?\)\s*$/, "")
    .trim();
  const line = cleaned.split("\n").find((l) => l.trim()) ?? "";
  return line.length > MAX_TITLE_CHARS
    ? `${line.slice(0, MAX_TITLE_CHARS)}…`
    : line;
}
