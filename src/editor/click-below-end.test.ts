// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { closeViews, openView } from "./editor-view-kit";

vi.mock("../platform/capabilities", async (real) => ({
  ...(await real<typeof import("../platform/capabilities")>()),
  isIOSApp: true,
}));

afterEach(async () => {
  vi.restoreAllMocks();
  await closeViews();
});

function touch(target: Element, type: string, y: number) {
  const point = { clientX: 50, clientY: y };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    touches: type === "touchend" ? [] : [point],
    changedTouches: [point],
  });
  target.dispatchEvent(event);
}

it("a tap above a table keeps its caret when iOS then puts its own in the last paragraph", async () => {
  const t = await openView("above\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nlast");
  // The paragraph ends at 100, the table starts at 140.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const table = this.tagName === "TABLE" || !!this.querySelector("table");
      return (
        table ? { top: 140, bottom: 200 } : { top: 60, bottom: 100 }
      ) as DOMRect;
    },
  );
  t.caretAt("last");
  touch(t.view.dom, "touchstart", 120);
  touch(t.view.dom, "touchend", 120);
  const beside = t.view.state.selection.from;
  expect(t.caretLine()).toBe("above|");
  // iOS's own caret, read by the editor.
  t.caretAt("last");
  document.dispatchEvent(new Event("selectionchange"));
  await new Promise((done) => setTimeout(done, 10));
  expect(t.view.state.selection.from).toBe(beside);
});
