// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { closeViews, openView, type TestView } from "./editor-view-kit";
import { setWindowZoom } from "../engine/zoom/tab-zoom";

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

it("a tap above a table lets what is typed at once stay in order", async () => {
  const t = await openView("above\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nlast");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const table = this.tagName === "TABLE" || !!this.querySelector("table");
      return (
        table ? { top: 140, bottom: 200 } : { top: 60, bottom: 100 }
      ) as DOMRect;
    },
  );
  touch(t.view.dom, "touchstart", 120);
  touch(t.view.dom, "touchend", 120);
  // Each letter moves the caret, which is no caret of iOS's to take back.
  for (const letter of "ab") {
    t.type(letter);
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((done) => setTimeout(done, 10));
  }
  expect(t.caretLine()).toBe("aboveab|");
});

const click = (t: TestView, y: number) =>
  t.view.someProp("handleClick", (handle) =>
    handle(t.view, 0, { clientY: y } as MouseEvent),
  ) ?? false;
const blocks = (t: TestView) => t.view.state.doc.childCount;

it("a click below a table that ends the document starts a paragraph; below a list it doesn't", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 100,
    bottom: 200,
    width: 300,
  } as DOMRect);
  const table = await openView("| a | b |\n| - | - |\n| 1 | 2 |");
  expect(click(table, 150)).toBe(false);
  expect(click(table, 250)).toBe(true);
  expect(blocks(table)).toBe(2);
  // A list takes text at its end: the caret goes to its last line.
  const list = await openView("- one\n- two");
  expect(click(list, 250)).toBe(false);
  expect(blocks(list)).toBe(1);
});

it("counts the click against the table as drawn, the document zoomed", async () => {
  // As macOS's web view reports inside the zoom: laid out, not drawn.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 100,
    bottom: 200,
    width: 300,
  } as DOMRect);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(300);
  setWindowZoom(1.5);
  try {
    const t = await openView("| a | b |\n| - | - |\n| 1 | 2 |");
    // Drawn, the table ends at 300: 250 is still in its last row.
    expect(click(t, 250)).toBe(false);
    expect(blocks(t)).toBe(1);
    expect(click(t, 320)).toBe(true);
  } finally {
    setWindowZoom(1);
  }
});
