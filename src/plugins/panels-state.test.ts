// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { onPluginEvent } from "./app-bridge";
import { panelsState, usePanelsReport } from "./panels-state";

it("tells plugins once per change, and Zen mode closes every panel", () => {
  const heard: unknown[] = [];
  const stop = onPluginEvent("panels", (state) => heard.push(state));
  const props = {
    sidebarOpen: true,
    sidebarTab: "files",
    aiOpen: true,
    zen: false,
  };
  const { rerender } = renderHook((p) => usePanelsReport(p), {
    initialProps: props,
  });
  rerender({ ...props });
  expect(heard).toHaveLength(1);
  rerender({ ...props, aiOpen: false });
  expect(panelsState().ai.open).toBe(false);
  rerender({ ...props, zen: true });
  expect(panelsState()).toEqual({
    sidebar: { open: false, tab: "files" },
    ai: { open: false },
  });
  expect(heard).toHaveLength(3);
  stop();
});
