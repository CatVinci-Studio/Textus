// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  loadConversationTurns,
  saveConversation,
  useChatHistory,
} from "./chat-history";
import { storage } from "../../platform/ipc";

// The iOS app, whose container moved since the last version: the old
// conversation's absolute path points into the previous container.
const { DOCS, OLD } = vi.hoisted(() => ({
  DOCS: "/var/mobile/Containers/Data/Application/0000-AAAA/Documents",
  OLD: "/var/mobile/Containers/Data/Application/1111-BBBB/Documents",
}));

vi.mock("../../platform/capabilities", () => ({ isIOSApp: true }));
vi.mock("@tauri-apps/api/path", () => ({
  documentDir: () => Promise.resolve(DOCS),
}));
vi.mock("../../prefs/SettingsContext", () => ({
  loadSettings: () => ({ enableChatHistory: true }),
}));
vi.mock("../../platform/ipc", () => ({
  storage: {
    historyList: vi.fn(),
    historyUpsert: vi.fn().mockResolvedValue(null),
    historyRemove: vi.fn().mockResolvedValue(null),
    historyClear: vi.fn().mockResolvedValue(null),
    chatHistoryGet: vi.fn(),
    chatHistoryMoveDocument: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("../../platform/events", () => ({
  listenToThisWindow: () => Promise.resolve(() => {}),
}));

/** A line of the index, as Rust lists it. */
const summary = (id: string, docPath: string | null, updatedAt: number) => ({
  id,
  docPath,
  title: id,
  updatedAt,
  turnCount: 1,
});
const turns = [{ kind: "User" as const, text: "hello" }];
const conversation = (id: string, docPath: string, updatedAt: number) => ({
  id,
  docPath,
  title: id,
  updatedAt,
  turns,
});

beforeAll(() => {
  (window as unknown as { __BOOT__: unknown }).__BOOT__ = {
    settings: {},
    rev: 1,
    uiState: {},
    label: "main",
  };
});

describe("chat history", () => {
  it("lists the index and keeps each conversation's turns out of it", async () => {
    vi.mocked(storage.historyList).mockResolvedValue([
      summary("old", `${OLD}/novel/ch1.md`, 3),
      summary("picked", "file:///private/var/mobile/Library/x/a.md", 2),
      summary("draft", null, 1),
    ]);
    const { result } = renderHook(() => useChatHistory());

    // iOS: read back in this container's Documents folder...
    await waitFor(() =>
      expect(result.current.map((e) => e.docPath)).toEqual([
        `${DOCS}/novel/ch1.md`,
        "file:///private/var/mobile/Library/x/a.md",
        null,
      ]),
    );
    // ...and the old absolute path rewritten, once: the conversations move
    // with their document, since the list has no whole entries to save.
    expect(vi.mocked(storage.chatHistoryMoveDocument).mock.calls).toEqual([
      [`${OLD}/novel/ch1.md`, "documents:novel/ch1.md"],
    ]);
    expect(storage.historyUpsert).not.toHaveBeenCalled();

    // A conversation saved now goes to Rust whole, its document relative...
    act(() => saveConversation(conversation("new", `${DOCS}/novel/ch2.md`, 4)));
    expect(storage.historyUpsert).toHaveBeenLastCalledWith(
      "chat",
      conversation("new", "documents:novel/ch2.md", 4),
    );
    // ...and joins the list as its summary, in the same project group.
    expect(result.current[0]).toEqual({
      ...summary("new", `${DOCS}/novel/ch2.md`, 4),
      turnCount: 1,
    });
    expect(result.current[0]).not.toHaveProperty("turns");
    expect(result.current[1].docPath).toBe(`${DOCS}/novel/ch1.md`);
  });

  it("reads a conversation's turns from its file when it is reopened", async () => {
    vi.mocked(storage.chatHistoryGet).mockResolvedValueOnce(
      conversation("a", "/a.md", 1),
    );
    expect(await loadConversationTurns("a")).toEqual(turns);
    vi.mocked(storage.chatHistoryGet).mockResolvedValueOnce(null);
    expect(await loadConversationTurns("gone")).toBeNull();
  });
});
