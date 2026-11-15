// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView } from "./editor-view-kit";

afterEach(closeViews);

function touch(el: Element, type: string, y: number) {
  const point = { clientX: 20, clientY: y };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    touches: type === "touchstart" ? [point] : [],
    changedTouches: [point],
  });
  el.dispatchEvent(event);
  return event;
}

describe("a finger's tap below a table that ends the document", () => {
  it("starts a paragraph there, the caret in it; a scroll from there doesn't", async () => {
    const t = await openView("one line\n\n| a | b |\n| - | - |\n| c | d |\n");
    const table = t.view.dom.querySelector("table")!;
    const below = table.getBoundingClientRect().bottom + 50;
    touch(t.view.dom, "touchstart", below);
    touch(t.view.dom, "touchmove", below - 40);
    touch(t.view.dom, "touchend", below - 40);
    expect(t.view.state.doc.lastChild?.type.name).toBe("table");

    touch(t.view.dom, "touchstart", below);
    const end = touch(t.view.dom, "touchend", below);
    expect(end.defaultPrevented).toBe(true);
    expect(t.view.state.doc.lastChild?.type.name).toBe("paragraph");
    t.type("after");
    expect(t.caretLine()).toBe("after|");
  });
});
