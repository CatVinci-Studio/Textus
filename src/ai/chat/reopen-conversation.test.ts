// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reopenConversation } from "./reopen-conversation";
import { claimChatRestore } from "./chat-restore";
import { deleteConversation } from "./chat-history";
import { fs } from "../../platform/ipc";
import { showConfirm } from "../../ui/app-dialog";
import { OPEN_FILE_IN_TAB_EVENT } from "../../utils/events";
import type { Strings } from "../../i18n/strings";

const turns = [{ kind: "User", text: "hello" }];

vi.mock("./chat-history", () => ({
  loadConversationTurns: vi.fn((id: string) =>
    Promise.resolve(id === "gone" ? null : turns),
  ),
  deleteConversation: vi.fn(),
}));
vi.mock("../../platform/ipc", () => ({ fs: { readTextFile: vi.fn() } }));
vi.mock("../../ui/app-dialog", () => ({ showConfirm: vi.fn() }));

const t = {
  chatHistoryMissingText: "{name} is gone",
  chatHistoryMissingTitle: "Missing",
  chatHistoryContinueHere: "Continue Here",
  cancel: "Cancel",
} as Strings;

const entry = (id: string, docPath: string | null) => ({
  id,
  docPath,
  title: id,
  updatedAt: 1,
});

let opened: string[];
beforeEach(() => {
  vi.clearAllMocks();
  opened = [];
  window.addEventListener(OPEN_FILE_IN_TAB_EVENT, (e) =>
    opened.push((e as CustomEvent<string>).detail),
  );
  // Nothing left over from the previous case.
  claimChatRestore(null, () => true);
});

describe("reopening a past conversation", () => {
  it("opens its own document and restores it there, not on screen", async () => {
    vi.mocked(fs.readTextFile).mockResolvedValue("text");
    await reopenConversation(entry("a", "/novel/ch1.md"), t);
    expect(opened).toEqual(["/novel/ch1.md"]);
    // The document on screen doesn't take it; that document's editor does.
    expect(claimChatRestore("/notes/other.md", () => true)).toBeNull();
    expect(claimChatRestore("/novel/ch1.md", () => false)).toEqual({
      id: "a",
      turns,
      docPath: "/novel/ch1.md",
    });
    expect(showConfirm).not.toHaveBeenCalled();
  });

  it("asks before continuing in the current document when its document is gone", async () => {
    vi.mocked(fs.readTextFile).mockRejectedValue(new Error("not found"));
    vi.mocked(showConfirm).mockResolvedValue(false);
    await reopenConversation(entry("a", "/novel/ch1.md"), t);
    expect(showConfirm).toHaveBeenCalledWith(
      "ch1.md is gone",
      expect.objectContaining({ okLabel: "Continue Here" }),
    );
    expect(opened).toEqual([]);
    expect(claimChatRestore("/here.md", () => true)).toBeNull();

    vi.mocked(showConfirm).mockResolvedValue(true);
    await reopenConversation(entry("a", "/novel/ch1.md"), t);
    expect(claimChatRestore("/here.md", () => true)).toMatchObject({
      id: "a",
      docPath: null,
    });
  });

  it("continues a never-saved document's conversation in the current one", async () => {
    await reopenConversation(entry("draft", null), t);
    expect(fs.readTextFile).not.toHaveBeenCalled();
    expect(opened).toEqual([]);
    expect(claimChatRestore(null, () => true)).toMatchObject({ id: "draft" });
  });

  it("drops a line whose conversation file is gone", async () => {
    await reopenConversation(entry("gone", "/a.md"), t);
    expect(deleteConversation).toHaveBeenCalledWith("gone");
    expect(claimChatRestore("/a.md", () => true)).toBeNull();
  });

  it("lands where its target says: the detached window takes it itself", async () => {
    vi.mocked(fs.readTextFile).mockResolvedValue("text");
    const target = { restore: vi.fn(), openDocument: vi.fn() };
    await reopenConversation(entry("a", "/novel/ch1.md"), t, target);
    expect(target.restore).toHaveBeenCalledWith({
      id: "a",
      turns,
      docPath: "/novel/ch1.md",
    });
    expect(target.openDocument).toHaveBeenCalledWith("/novel/ch1.md");
    // Nothing for this window's editors to claim.
    expect(opened).toEqual([]);
    expect(claimChatRestore("/novel/ch1.md", () => true)).toBeNull();
  });
});
