import { beforeEach, describe, expect, it, vi } from "vitest";

// Asynchronous like the real store: every reader waits on the same live
// re-read, so two documents opening at launch both read before either writes.
const stored = vi.hoisted(() => ({
  list: [] as unknown,
  ready: Promise.resolve() as Promise<void>,
  /** The next read of the list fails (storage unavailable). */
  readFail: false,
}));

vi.mock("../platform/capabilities", () => ({ isMobileApp: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({
  documentDir: async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    return "/app/Documents";
  },
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("../storage/ui-state", () => ({
  uiStateReady: () => stored.ready,
  getUiState: () => {
    if (stored.readFail) {
      stored.readFail = false;
      throw new Error("no Documents");
    }
    return stored.list;
  },
  setUiState: (_key: string, value: unknown) => {
    stored.list = value;
  },
}));

const {
  forgetIOSDocument,
  recentIOSDocuments,
  rememberIOSDocument,
  renameIOSDocument,
} = await import("./ios-recents");
const { invoke } = await import("@tauri-apps/api/core");

beforeEach(() => {
  stored.list = [];
  stored.readFail = false;
  // The live re-read lands a little after everything below has started.
  stored.ready = new Promise((resolve) => setTimeout(resolve, 20));
});

describe("iOS recent documents", () => {
  it("keeps both of two documents opened at the same moment", async () => {
    await Promise.all([
      rememberIOSDocument("/app/Documents/a.md"),
      rememberIOSDocument("file:///private/iCloud/b.md"),
    ]);
    expect(stored.list).toEqual([
      "file:///private/iCloud/b.md",
      "documents:a.md",
    ]);
    expect(await recentIOSDocuments()).toEqual([
      "file:///private/iCloud/b.md",
      "/app/Documents/a.md",
    ]);
  });

  it("orders a forget after a remember started before it", async () => {
    stored.list = ["documents:old.md"];
    await Promise.all([
      rememberIOSDocument("/app/Documents/new.md"),
      forgetIOSDocument("/app/Documents/old.md"),
    ]);
    expect(stored.list).toEqual(["documents:new.md"]);
  });

  it("keeps an entry remembered while a rename is on its way", async () => {
    stored.list = ["documents:draft.md"];
    vi.mocked(invoke).mockResolvedValue("/app/Documents/final.md");
    await Promise.all([
      renameIOSDocument("/app/Documents/draft.md", "final"),
      rememberIOSDocument("/app/Documents/other.md"),
    ]);
    expect(stored.list).toEqual(["documents:other.md", "documents:final.md"]);
  });

  it("keeps a file in another app's folder by its full path", async () => {
    const other =
      "/private/var/mobile/Containers/Data/Application/AB-12/Documents/vault/a.md";
    await rememberIOSDocument(other);
    expect(stored.list).toEqual([other]);
    expect(await recentIOSDocuments()).toEqual([other]);
  });

  it("doesn't stall the queue on a change that failed inside it", async () => {
    stored.list = ["documents:a.md"];
    stored.readFail = true;
    const failed = rememberIOSDocument("/app/Documents/b.md");
    const next = rememberIOSDocument("/app/Documents/c.md");
    await expect(failed).rejects.toThrow("no Documents");
    await next;
    expect(stored.list).toEqual(["documents:c.md", "documents:a.md"]);
    expect(await recentIOSDocuments()).toEqual([
      "/app/Documents/c.md",
      "/app/Documents/a.md",
    ]);
  });

  it("carries on after a change that failed", async () => {
    stored.list = ["documents:a.md"];
    vi.mocked(invoke).mockRejectedValue(new Error("gone"));
    await expect(
      renameIOSDocument("/app/Documents/a.md", "b"),
    ).rejects.toThrow();
    await rememberIOSDocument("/app/Documents/c.md");
    expect(stored.list).toEqual(["documents:c.md", "documents:a.md"]);
  });
});
