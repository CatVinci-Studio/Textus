// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useIslandNumbers } from "./useIslandNumbers";
import {
  activateTab,
  resetWindowModelForTests,
  startWindowTabs,
} from "../../engine/layout/store";

afterEach(() => {
  cleanup();
  resetWindowModelForTests();
  document.body.replaceChildren();
});

const frame = () => new Promise((done) => requestAnimationFrame(done));

it("puts the focus in a tab brought to the front when it would be lost (Ctrl+Tab, a close)", async () => {
  document.body.innerHTML = `<div class="main-pane"><div data-tab-id="a"></div><div data-tab-id="b"><textarea></textarea></div></div>`;
  startWindowTabs([{ id: "a" }, { id: "b" }], () => ({ id: "blank" }));
  renderHook(() => useIslandNumbers(() => {}));
  act(() => activateTab("b"));
  await act(frame);
  await act(frame);
  expect(document.activeElement?.tagName).toBe("TEXTAREA");
});
