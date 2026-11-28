// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Strings } from "../../i18n/strings";
import { SplitDivider } from "./SplitDivider";
import { pairLayout } from "./ops";
import {
  resetWindowModelForTests,
  setSplitLayout,
  setWindowTabs,
  subscribeSplit,
  windowLayout,
} from "./store";
import type { Branch, Divider } from "./tree";

// What a divider between two documents keeps: where it is let go, or,
// cancelled, where it started.

const t = { splitDivider: "Split divider", menuCloseSplit: "Close" } as Strings;
const line: Divider = {
  path: [],
  index: 0,
  direction: "row",
  at: 500,
  from: 0,
  to: 800,
};

/** The first pane's share of the two. */
const share = () => {
  const { sizes } = windowLayout().root as Branch;
  return sizes[0] / (sizes[0] + sizes[1]);
};

function divider() {
  render(
    <SplitDivider
      layout={windowLayout()}
      line={line}
      style={{}}
      frame="divider::0"
      reach={false}
      // A 10px gap at 495-505: the share is (x - 5) / 995.
      sides={{
        before: { start: 0, end: 495 },
        after: { start: 505, end: 1005 },
      }}
      fixed={null}
      t={t}
    />,
  );
  const el = screen.getByRole("separator");
  // jsdom has no pointer capture.
  el.setPointerCapture = () => {};
  el.hasPointerCapture = () => false;
  return el;
}

beforeEach(() => {
  setWindowTabs(() => [{ id: "a" }, { id: "b" }]);
  setSplitLayout(pairLayout("row", "a", "b"));
});

afterEach(() => {
  cleanup();
  resetWindowModelForTests();
});

describe("a divider between two documents", () => {
  it("keeps the share it is let go at", () => {
    const el = divider();
    fireEvent.pointerDown(el, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 405, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 405, pointerId: 1 });
    expect(share()).toBeCloseTo(400 / 995, 3);
  });

  it("goes back to where it started when Esc cancels the drag", () => {
    const el = divider();
    fireEvent.pointerDown(el, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 300, pointerId: 1 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(el, { clientX: 300, pointerId: 1 });
    expect(share()).toBeCloseTo(0.5, 3);
  });

  it("steps by an arrow key, kept at once", () => {
    const el = divider();
    let told = 0;
    const stop = subscribeSplit(() => told++);
    fireEvent.keyDown(el, { key: "ArrowRight" });
    stop();
    expect(share()).toBeCloseTo(0.55, 3);
    expect(told).toBe(1);
  });
});
