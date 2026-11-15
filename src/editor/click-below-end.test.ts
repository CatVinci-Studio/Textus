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

describe("a finger's tap in the gap under a table", () => {
  it("puts the caret at the start of the next paragraph itself", async () => {
    const t = await openView("| a | b |\n| - | - |\n| c | d |\n\nwrod here\n");
    const table = t.view.nodeDOM(0) as HTMLElement;
    const next = t.view.nodeDOM(
      t.view.state.doc.child(0).nodeSize,
    ) as HTMLElement;
    table.getBoundingClientRect = () => ({ top: 0, bottom: 100 }) as DOMRect;
    next.getBoundingClientRect = () => ({ top: 120, bottom: 140 }) as DOMRect;
    touch(t.view.dom, "touchstart", 110);
    const end = touch(t.view.dom, "touchend", 110);
    expect(end.defaultPrevented).toBe(true);
    expect(t.caretLine()).toBe("|wrod here");
  });
});
