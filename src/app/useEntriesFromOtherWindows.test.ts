// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useEntriesFromOtherWindows } from "./useEntriesFromOtherWindows";

const heard = vi.hoisted(() => ({
  fire: null as null | ((p: unknown) => void),
}));
vi.mock("../platform/events", () => ({
  listenToThisWindow: (_e: string, h: (e: { payload: unknown }) => void) => {
    heard.fire = (payload) => h({ payload });
    return Promise.resolve(() => {});
  },
  unlistenAll: () => () => {},
}));
vi.mock("../storage/boot", () => ({ readBoot: () => ({ label: "main" }) }));

it("follows a move made in another window, not one made here", () => {
  const follow = vi.fn();
  const trashed = vi.fn();
  window.addEventListener("textus:entry-trashed", trashed);
  renderHook(() => useEntriesFromOtherWindows(follow));
  heard.fire!({ from: "main", moved: ["/w/a.md", "/w/b.md"], trashed: null });
  expect(follow).not.toHaveBeenCalled();
  heard.fire!({ from: "w2", moved: ["/w/a.md", "/w/b.md"], trashed: null });
  expect(follow).toHaveBeenCalledWith("/w/a.md", "/w/b.md");
  heard.fire!({ from: "w2", moved: null, trashed: "/w/c.md" });
  expect(trashed).toHaveBeenCalledOnce();
});
