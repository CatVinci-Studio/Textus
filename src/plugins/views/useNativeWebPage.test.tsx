// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("../../platform/ipc", () => ({
  webPages: Object.fromEntries(
    ["show", "hide", "close", "reload"].map((name) => [
      name,
      (id: string) => (calls.push(`${name} ${id}`), Promise.resolve()),
    ]),
  ),
}));
vi.mock("../../platform/events", () => ({
  listenToThisWindow: () => Promise.resolve(() => {}),
  unlistenAll: () => () => {},
}));

const { useNativeWebPage } = await import("./useNativeWebPage");

/** Frames and the cover's watcher (a microtask, then a frame) run. */
const settle = async (ms = 50) => {
  for (let i = 0; i < 3; i++)
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(ms);
    });
};
const { memoryLimits } = await import("../../utils/memory-policy");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "requestAnimationFrame"] });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  calls.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("a page under a menu hides, but isn't let go however long the menu stays", async () => {
  const holder = document.body.appendChild(document.createElement("div"));
  holder.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 300 }) as DOMRect;
  renderHook(() =>
    useNativeWebPage(
      "w1",
      "https://example.com",
      { current: holder },
      () => {},
    ),
  );
  await settle();
  expect(calls).toContain("show w1");
  const menu = document.body.appendChild(document.createElement("div"));
  menu.setAttribute("role", "menu");
  await settle();
  expect(calls).toContain("hide w1");
  await settle(memoryLimits().hiddenMs);
  expect(calls).not.toContain("close w1");
});
