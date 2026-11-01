// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSAVE_IDLE_MS,
  autosaveWants,
  useAutosave,
  type SaveOutcome,
} from "./autosave";
import type { DocTab } from "./doc-tabs";

const focus = vi.hoisted(() => ({
  handler: null as null | ((e: { payload: boolean }) => void),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: (h: (e: { payload: boolean }) => void) => {
      focus.handler = h;
      return Promise.resolve(() => {});
    },
  }),
}));

const saved: DocTab = {
  id: "a",
  path: "/notes/a.md",
  content: "edited",
  savedContent: "original",
  diskMtime: 1,
  sourceMode: false,
  reloadKey: 0,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function render(
  tabs: DocTab[],
  outcome: SaveOutcome = "saved",
  enabled = true,
) {
  const autosaveTab = vi.fn(() => Promise.resolve(outcome));
  const hook = renderHook(
    (props: { tabs: DocTab[]; activeTabId: string; enabled: boolean }) =>
      useAutosave({ ...props, autosaveTab }),
    { initialProps: { tabs, activeTabId: tabs[0].id, enabled } },
  );
  return { autosaveTab, ...hook };
}

const settle = () => act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS));

describe("which tabs autosave writes", () => {
  it("writes an untitled document with text in it", () => {
    expect(autosaveWants({ ...saved, path: null }, undefined)).toBe(true);
  });
  it("leaves an empty untitled document and the tour's practice tab alone", () => {
    const draft = { ...saved, path: null, savedContent: "" };
    expect(autosaveWants({ ...draft, content: "  \n" }, undefined)).toBe(false);
    expect(autosaveWants(draft, undefined, "a")).toBe(false);
  });
  it("skips a document with nothing new", () => {
    expect(autosaveWants({ ...saved, content: "original" }, undefined)).toBe(
      false,
    );
  });
  it("stays paused until the tab is saved or reloaded some other way", () => {
    const pause = { path: saved.path, savedContent: "original", diskMtime: 1 };
    expect(autosaveWants(saved, pause)).toBe(false);
    expect(autosaveWants({ ...saved, content: "more" }, pause)).toBe(false);
    expect(autosaveWants({ ...saved, diskMtime: 2 }, pause)).toBe(true);
    expect(autosaveWants({ ...saved, savedContent: "x" }, pause)).toBe(true);
  });
});

describe("autosave scheduling", () => {
  it("writes a saved document once typing has rested", async () => {
    const { autosaveTab, rerender } = render([saved]);
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS - 500));
    rerender({
      tabs: [{ ...saved, content: "edited more" }],
      activeTabId: "a",
      enabled: true,
    });
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS - 500));
    expect(autosaveTab).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(autosaveTab).toHaveBeenCalledTimes(1);
  });

  it("never writes while the setting is off", async () => {
    const { autosaveTab, result } = render([saved], "saved", false);
    await settle();
    await act(() => result.current());
    expect(autosaveTab).not.toHaveBeenCalled();
  });

  it("writes an untitled document once typing has rested", async () => {
    const { autosaveTab } = render([{ ...saved, path: null }]);
    await settle();
    expect(autosaveTab).toHaveBeenCalledWith("a");
  });

  it("never writes the tour's practice tab, even on a flush", async () => {
    const autosaveTab = vi.fn(() => Promise.resolve<SaveOutcome>("saved"));
    const { result } = renderHook(() =>
      useAutosave({
        tabs: [{ ...saved, path: null }],
        activeTabId: "a",
        enabled: true,
        practiceTabId: "a",
        autosaveTab,
      }),
    );
    await settle();
    await act(() => result.current());
    expect(autosaveTab).not.toHaveBeenCalled();
  });

  it("writes at once when the window loses focus", async () => {
    const { autosaveTab } = render([saved]);
    await act(async () => focus.handler?.({ payload: false }));
    expect(autosaveTab).toHaveBeenCalledTimes(1);
    await settle();
    expect(autosaveTab).toHaveBeenCalledTimes(1);
  });

  it("writes the tab left behind when another tab is chosen", async () => {
    const other = { ...saved, id: "b", content: "x", savedContent: "x" };
    const { autosaveTab, rerender } = render([saved, other]);
    await act(async () =>
      rerender({ tabs: [saved, other], activeTabId: "b", enabled: true }),
    );
    expect(autosaveTab).toHaveBeenCalledWith("a");
  });

  it.each(["conflict", "failed"] as const)(
    "after a %s, stops until the user has saved, so the prompt shows once",
    async (outcome) => {
      const { autosaveTab, rerender, result } = render([saved], outcome);
      await settle();
      expect(autosaveTab).toHaveBeenCalledTimes(1);
      rerender({
        tabs: [{ ...saved, content: "typing on" }],
        activeTabId: "a",
        enabled: true,
      });
      await settle();
      await act(() => result.current());
      expect(autosaveTab).toHaveBeenCalledTimes(1);
      // A manual save that went through moves the tab on: autosave resumes.
      rerender({
        tabs: [{ ...saved, content: "next", savedContent: "typing on" }],
        activeTabId: "a",
        enabled: true,
      });
      await settle();
      expect(autosaveTab).toHaveBeenCalledTimes(2);
    },
  );

  it("runs one save of a tab at a time", async () => {
    let finish!: (o: SaveOutcome) => void;
    const autosaveTab = vi.fn(
      () => new Promise<SaveOutcome>((r) => (finish = r)),
    );
    const { result } = renderHook(() =>
      useAutosave({
        tabs: [saved],
        activeTabId: "a",
        enabled: true,
        autosaveTab,
      }),
    );
    let both!: Promise<unknown>;
    act(() => {
      both = Promise.all([result.current(), result.current()]);
    });
    await act(() => Promise.resolve());
    expect(autosaveTab).toHaveBeenCalledTimes(1);
    await act(async () => finish("conflict"));
    await act(() => both);
    // The second waited, then saw the pause the first one's conflict left.
    expect(autosaveTab).toHaveBeenCalledTimes(1);
  });
});
