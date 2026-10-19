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
import { cleanup, renderHook } from "@testing-library/react";
import { installTestLocalStorage } from "../dev/test-local-storage";
import { registerTabCaret, reportTabCaret } from "../editor/tab-caret";
import { makeBlankTab, type DocTab } from "./doc-tabs";
import { flushPendingWrites } from "../storage/pending-writes";
import {
  lastCaret,
  mergeCarets,
  rememberCaret,
  resetLastCaretsForTests,
  useLastCarets,
} from "./last-carets";

const KEY = "textus-last-carets";
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "null");

beforeAll(installTestLocalStorage);
beforeEach(() => {
  localStorage.clear();
  resetLastCaretsForTests();
});
afterEach(() => vi.useRealTimers());

describe("mergeCarets", () => {
  it("puts the newest last and drops the oldest past the limit", () => {
    const merged = mergeCarets(
      { "/a.md": { offset: 1, mtime: 1 }, "/b.md": { offset: 2, mtime: 1 } },
      new Map([
        ["/a.md", { offset: 5, mtime: 2 }],
        ["/c.md", { pos: 9, mtime: 3 }],
      ]),
      2,
    );
    expect(Object.keys(merged)).toEqual(["/a.md", "/c.md"]);
    expect(merged["/a.md"]).toEqual({ offset: 5, mtime: 2 });
  });

  it("keeps only valid entries of what was stored", () => {
    expect(
      mergeCarets(
        {
          "/ok.md": { offset: 0, mtime: 1 },
          "/no-time.md": { offset: 3 },
          "/negative.md": { offset: -1, mtime: 1 },
          "/text.md": "12",
        },
        new Map(),
      ),
    ).toEqual({ "/ok.md": { offset: 0, mtime: 1 } });
    expect(mergeCarets("garbage", new Map())).toEqual({});
  });
});

describe("the last caret of a document", () => {
  it("comes back while the file is unchanged, not once it changed", () => {
    rememberCaret("/a.md", { offset: 42 }, 100);
    expect(lastCaret("/a.md", 100)).toEqual({ offset: 42 });
    expect(lastCaret("/a.md", 101)).toBeNull();
    expect(lastCaret("/a.md", null)).toBeNull();
    expect(lastCaret("/b.md", 100)).toBeNull();
  });

  it("is written once a burst of carets rests", () => {
    vi.useFakeTimers();
    rememberCaret("/a.md", { offset: 1 }, 1);
    rememberCaret("/b.md", { pos: 2 }, 1);
    rememberCaret("/a.md", { offset: 3 }, 1);
    expect(stored()).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(stored()).toEqual({
      "/b.md": { pos: 2, mtime: 1 },
      "/a.md": { offset: 3, mtime: 1 },
    });
  });

  it("adds to what is stored rather than replacing it", () => {
    vi.useFakeTimers();
    localStorage.setItem(
      KEY,
      JSON.stringify({ "/other-window.md": { offset: 7, mtime: 1 } }),
    );
    rememberCaret("/a.md", { offset: 1 }, 1);
    vi.advanceTimersByTime(1000);
    expect(Object.keys(stored())).toEqual(["/other-window.md", "/a.md"]);
    expect(lastCaret("/other-window.md", 1)).toEqual({ offset: 7 });
  });
});

describe("useLastCarets", () => {
  const tab = (id: string, path: string | null): DocTab => ({
    ...makeBlankTab(),
    id,
    path,
    diskMtime: 5,
  });
  afterEach(cleanup);

  it("remembers the caret a tab's editor reports as it leaves", () => {
    renderHook(() => useLastCarets([tab("t", "/a.md")], "t", true));
    reportTabCaret("t", { offset: 4 });
    expect(lastCaret("/a.md", 5)).toEqual({ offset: 4 });
  });

  it("writes the active tab's caret at once when the window closes", async () => {
    renderHook(() => useLastCarets([tab("t", "/a.md")], "t", true));
    const stop = registerTabCaret("t", () => ({ offset: 12 }));
    await flushPendingWrites();
    expect(stored()).toEqual({ "/a.md": { offset: 12, mtime: 5 } });
    stop();
  });

  it("asks again, at closing, of each tab that has been on screen", async () => {
    // a.md was left at 4, then saved (its time 5 -> 6) while b.md showed.
    let tabs = [tab("a", "/a.md"), tab("b", "/b.md"), tab("c", "/c.md")];
    const { rerender } = renderHook(() => useLastCarets(tabs, "b", true));
    reportTabCaret("a", { offset: 4 });
    tabs = [{ ...tabs[0], diskMtime: 6 }, tabs[1], tabs[2]];
    rerender();
    const stops = ["a", "b", "c"].map((id) =>
      registerTabCaret(id, () => ({ offset: 9 })),
    );
    await flushPendingWrites();
    expect(stored()).toEqual({
      "/a.md": { offset: 9, mtime: 6 },
      "/b.md": { offset: 9, mtime: 5 },
    });
    stops.forEach((stop) => stop());
  });

  it("remembers nothing for a document without a file", () => {
    renderHook(() => useLastCarets([tab("t", null)], "t", true));
    reportTabCaret("t", { offset: 4 });
    expect(stored()).toBeNull();
  });

  it("remembers nothing with Restore Previous Session off", async () => {
    renderHook(() => useLastCarets([tab("t", "/a.md")], "t", false));
    reportTabCaret("t", { offset: 4 });
    await flushPendingWrites();
    expect(lastCaret("/a.md", 5)).toBeNull();
    expect(stored()).toBeNull();
  });
});
