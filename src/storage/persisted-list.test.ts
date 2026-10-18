// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createPersistedList } from "./persisted-list";
import { storage } from "../platform/ipc";
import { resetBootForTests } from "./boot";
import { installTestLocalStorage } from "../dev/test-local-storage";

const handlers: Record<string, (event: { payload: unknown }) => void> = {};

vi.mock("../platform/ipc", () => ({
  storage: {
    historyList: vi.fn(),
    historyUpsert: vi.fn().mockResolvedValue(null),
    historyRemove: vi.fn().mockResolvedValue(null),
    historyClear: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("../utils/tauri-events", () => ({
  listenToThisWindow: (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    handlers[event] = handler;
    return Promise.resolve(() => {});
  },
}));

interface Entry {
  id: string;
  at: number;
}

function makeList() {
  return createPersistedList<Entry>("test-list", {
    kind: "chat",
    max: 3,
    keyOf: (e) => e.id,
    isEntry: (e): e is Entry => typeof (e as Entry)?.id === "string",
    sort: (a, b) => b.at - a.at,
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(installTestLocalStorage);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetBootForTests();
});

afterEach(() => {
  delete (window as unknown as { __BOOT__?: unknown }).__BOOT__;
});

describe("without Rust (localStorage)", () => {
  it("keeps the list under its key, capped and sorted", () => {
    const list = makeList();
    for (let i = 0; i < 5; i++) list.upsert({ id: `e${i}`, at: i });
    list.upsert({ id: "e3", at: 9 });
    expect(list.get().map((e) => e.id)).toEqual(["e3", "e4", "e2"]);
    expect(JSON.parse(localStorage.getItem("test-list")!)).toHaveLength(3);
    expect(storage.historyUpsert).not.toHaveBeenCalled();
  });
});

describe("with Rust (file-backed)", () => {
  beforeEach(() => {
    (window as unknown as { __BOOT__: unknown }).__BOOT__ = {
      settings: {},
      rev: 1,
      uiState: {},
      legacyImport: false,
      label: "main",
    };
  });

  it("loads from Rust and sends one entry per change, never the list", async () => {
    vi.mocked(storage.historyList).mockResolvedValue([
      { id: "a", at: 1 },
      { broken: true },
    ]);
    const list = makeList();
    expect(list.get()).toEqual([]);
    await flush();
    expect(list.get()).toEqual([{ id: "a", at: 1 }]);
    list.upsert({ id: "b", at: 2 });
    list.remove("a");
    list.clear();
    expect(storage.historyUpsert).toHaveBeenCalledWith("chat", {
      id: "b",
      at: 2,
    });
    expect(storage.historyRemove).toHaveBeenCalledWith("chat", "a");
    expect(storage.historyClear).toHaveBeenCalledWith("chat");
    expect(localStorage.getItem("test-list")).toBeNull();
  });

  it("sends a whole entry but lists only what `listed` keeps of it", async () => {
    vi.mocked(storage.historyList).mockResolvedValue([]);
    const list = createPersistedList<Entry, Entry & { body: string }>(
      "test-listed",
      {
        kind: "chat",
        max: 3,
        keyOf: (e) => e.id,
        isEntry: (e): e is Entry => typeof (e as Entry)?.id === "string",
        listed: ({ id, at }) => ({ id, at }),
      },
    );
    list.upsert({ id: "a", at: 1, body: "long" });
    expect(storage.historyUpsert).toHaveBeenCalledWith("chat", {
      id: "a",
      at: 1,
      body: "long",
    });
    expect(list.get()).toEqual([{ id: "a", at: 1 }]);
    // Replayed onto the first load as listed, too.
    await flush();
    expect(list.get()).toEqual([{ id: "a", at: 1 }]);
  });

  it("keeps a change made before the first load arrives", async () => {
    let answer!: (list: unknown[]) => void;
    vi.mocked(storage.historyList).mockReturnValue(
      new Promise((resolve) => (answer = resolve)),
    );
    const list = makeList();
    list.get();
    await flush();
    list.upsert({ id: "new", at: 5 });
    // Rust's answer predates the upsert.
    answer([{ id: "old", at: 1 }]);
    await flush();
    expect(list.get().map((e) => e.id)).toEqual(["new", "old"]);
  });

  it("lets a reload that overtakes the first load win, keeping later changes", async () => {
    const answers: ((list: unknown[]) => void)[] = [];
    vi.mocked(storage.historyList).mockImplementation(
      () => new Promise((resolve) => answers.push(resolve)),
    );
    const list = makeList();
    list.get();
    await flush();
    // The import landed while the first load was on its way.
    handlers["history-changed"]({
      payload: { kind: "chat", op: { type: "reload" }, from: "" },
    });
    await flush();
    list.upsert({ id: "new", at: 5 });
    // The first answer is out of date; the second predates the upsert.
    answers[0]([{ id: "stale", at: 1 }]);
    await flush();
    answers[1]([{ id: "imported", at: 1 }]);
    await flush();
    expect(list.get().map((e) => e.id)).toEqual(["new", "imported"]);
  });

  it("applies other windows' changes and skips its own", async () => {
    vi.mocked(storage.historyList).mockResolvedValue([]);
    const list = makeList();
    // Subscribing is what a sidebar panel does.
    list.get();
    await flush();
    const event = (op: object, from = "window-2", kind = "chat") =>
      handlers["history-changed"]({ payload: { kind, op, from } });
    event({ type: "upsert", entry: { id: "x", at: 1 } });
    event({ type: "upsert", entry: { id: "y", at: 2 } }, "main");
    event(
      { type: "upsert", entry: { id: "z", at: 3 } },
      "window-2",
      "clipboard",
    );
    expect(list.get().map((e) => e.id)).toEqual(["x"]);
    event({ type: "remove", key: "x" });
    expect(list.get()).toEqual([]);
    // The legacy import replaced the whole list: fetch it again.
    vi.mocked(storage.historyList).mockResolvedValue([
      { id: "imported", at: 1 },
    ]);
    event({ type: "reload" }, "");
    await flush();
    expect(list.get().map((e) => e.id)).toEqual(["imported"]);
  });

  describe("normalise", () => {
    interface Doc {
      id: string;
      at: number;
      path: string;
    }
    // Stand-in for chat-history's: "old:" is the form an earlier build stored.
    const normalise = <E extends Doc>(e: E): E =>
      e.path.startsWith("old:") ? { ...e, path: `new:${e.path.slice(4)}` } : e;
    const makeDocs = () =>
      createPersistedList<Doc>("test-docs", {
        kind: "chat",
        max: 10,
        keyOf: (e) => e.id,
        isEntry: (e): e is Doc => typeof (e as Doc)?.id === "string",
        sort: (a, b) => b.at - a.at,
        normalise,
      });

    it("stores every entry written in the normal form", () => {
      vi.mocked(storage.historyList).mockReturnValue(new Promise(() => {}));
      const list = makeDocs();
      list.upsert({ id: "a", at: 1, path: "old:x" });
      expect(storage.historyUpsert).toHaveBeenCalledWith("chat", {
        id: "a",
        at: 1,
        path: "new:x",
      });
      expect(list.get()[0].path).toBe("new:x");
    });

    it("rewrites what an older build stored once the list loads", async () => {
      vi.mocked(storage.historyList).mockResolvedValue([
        { id: "a", at: 3, path: "old:x" },
        { id: "b", at: 2, path: "new:y" },
        { id: "c", at: 1, path: "old:z" },
      ]);
      const list = makeDocs();
      list.get();
      await flush();
      expect(list.get()).toEqual([
        { id: "a", at: 3, path: "new:x" },
        { id: "b", at: 2, path: "new:y" },
        { id: "c", at: 1, path: "new:z" },
      ]);
      // Only the outdated ones, as they were (same time, same place).
      expect(vi.mocked(storage.historyUpsert).mock.calls).toEqual([
        ["chat", { id: "a", at: 3, path: "new:x" }],
        ["chat", { id: "c", at: 1, path: "new:z" }],
      ]);
      // Loaded again (a reload), there is nothing left to rewrite.
      vi.mocked(storage.historyUpsert).mockClear();
      vi.mocked(storage.historyList).mockResolvedValue(list.get());
      handlers["history-changed"]({
        payload: { kind: "chat", op: { type: "reload" }, from: "" },
      });
      await flush();
      expect(storage.historyUpsert).not.toHaveBeenCalled();
    });

    it("never brings back an entry removed while the list was loading", async () => {
      let answer!: (list: unknown[]) => void;
      vi.mocked(storage.historyList).mockReturnValue(
        new Promise((resolve) => (answer = resolve)),
      );
      const list = makeDocs();
      list.get();
      await flush();
      list.remove("a");
      answer([{ id: "a", at: 1, path: "old:x" }]);
      await flush();
      expect(list.get()).toEqual([]);
      expect(storage.historyUpsert).not.toHaveBeenCalled();
    });
  });
});
