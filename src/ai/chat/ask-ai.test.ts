// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const taken = vi.hoisted(() => [] as (() => void)[]);
vi.mock("./composer-asks", () => ({
  askInComposer: () => new Promise<void>((done) => taken.push(done)),
}));
const { askAi, useAskAi } = await import("./ask-ai");

it("a second ask before the panel is up keeps its own mode", async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useAskAi(true, () => {}));
  act(() => askAi("first", "write"));
  act(() => askAi("second", "review"));
  // The first ask settles (the second took its place) before a composer
  // took the second.
  await act(async () => {
    taken[0]();
    await vi.runAllTimersAsync();
  });
  expect(result.current).toBe("review");
  vi.useRealTimers();
});
