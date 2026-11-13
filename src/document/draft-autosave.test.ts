// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftAutosave } from "./draft-autosave";
import { drafts } from "../platform/ipc";
import type { DocTab } from "./doc-tabs";
vi.mock("../platform/ipc", () => ({
  drafts: {
    saveDraftSnapshot: vi.fn().mockResolvedValue(undefined),
    clearDraftSnapshot: vi.fn().mockResolvedValue(undefined),
  },
}));
const tab: DocTab = {
  id: "test",
  path: null,
  content: "draft",
  savedContent: "",
  diskMtime: null,
  sourceMode: false,
  reloadKey: 0,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("draft recovery scheduling", () => {
  it("cancels pending writes when disabled and resumes when enabled", () => {
    const { rerender } = renderHook(
      ({ enabled }) => useDraftAutosave([tab], enabled),
      { initialProps: { enabled: true } },
    );
    advance(1000);
    rerender({ enabled: false });
    advance(4000);
    expect(drafts.saveDraftSnapshot).not.toHaveBeenCalled();
    rerender({ enabled: true });
    advance(3000);
    expect(drafts.saveDraftSnapshot).toHaveBeenCalledWith(
      "test",
      null,
      "draft",
      null,
    );
  });
  it("cancels writes on unmount", () => {
    const { unmount } = renderHook(() => useDraftAutosave([tab], true));
    unmount();
    advance(4000);
    expect(drafts.saveDraftSnapshot).not.toHaveBeenCalled();
  });
  it("flushes by 30 seconds even during uninterrupted typing", () => {
    const { rerender } = renderHook(
      ({ content }) => useDraftAutosave([{ ...tab, content }], true),
      { initialProps: { content: "0" } },
    );
    for (let i = 1; i <= 14; i++) {
      advance(2000);
      rerender({ content: String(i) });
    }
    advance(1999);
    expect(drafts.saveDraftSnapshot).not.toHaveBeenCalled();
    advance(1);
    expect(drafts.saveDraftSnapshot).toHaveBeenCalledWith(
      "test",
      null,
      "14",
      null,
    );
  });
  it("updates the path even when text is unchanged", () => {
    const { rerender } = renderHook(
      ({ path }: { path: string | null }) =>
        useDraftAutosave([{ ...tab, path }], true),
      { initialProps: { path: null as string | null } },
    );
    rerender({ path: "/new.md" });
    advance(3000);
    expect(drafts.saveDraftSnapshot).toHaveBeenCalledWith(
      "test",
      "/new.md",
      "draft",
      null,
    );
  });
  it("clears a saved or closed tab and cancels its timer", () => {
    const { rerender } = renderHook(
      ({ tabs }) => useDraftAutosave(tabs, true),
      { initialProps: { tabs: [tab] } },
    );
    rerender({ tabs: [{ ...tab, savedContent: tab.content }] });
    advance(3000);
    expect(drafts.saveDraftSnapshot).not.toHaveBeenCalled();
    expect(drafts.clearDraftSnapshot).toHaveBeenCalledWith("test");
  });
});
