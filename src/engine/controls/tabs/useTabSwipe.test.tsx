// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../platform/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isMobileApp: true,
  canHaptic: false,
}));
afterEach(cleanup);

const { useTabSwipe } = await import("./useTabSwipe");

function Row(props: { active: string; onActivate: (id: string) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  useTabSwipe(bar, ["a", "b", "c"], props.active, props.onActivate);
  return (
    <div ref={bar} data-testid="row">
      <div className="tab-pill" data-testid="pill" />
    </div>
  );
}

function touch(el: Element, type: string, x: number, y = 20) {
  const point = { clientX: x, clientY: y };
  const e = new Event(type, { bubbles: true, cancelable: true });
  const list = type === "touchend" ? [] : [point];
  Object.assign(e, { touches: list, changedTouches: [point] });
  el.dispatchEvent(e);
  return e;
}

/** The row's box: jsdom lays nothing out. */
function laidOut(row: Element) {
  row.getBoundingClientRect = () =>
    ({ top: 0, bottom: 40, left: 0, right: 400 }) as DOMRect;
}

function swipe(el: Element, from: number, to: number, toY = 20) {
  const row = el.closest("[data-testid=row]");
  if (row) laidOut(row);
  touch(el, "touchstart", from);
  const move = touch(el, "touchmove", (from + to) / 2, (20 + toY) / 2);
  touch(el, "touchend", to, toY);
  return move;
}

describe("swiping the tab row", () => {
  it("brings the next tab forward on a swipe left, the one before on a swipe right", async () => {
    const onActivate = vi.fn();
    const { getByTestId, rerender } = render(
      <Row active="b" onActivate={onActivate} />,
    );
    const move = swipe(getByTestId("pill"), 200, 100);
    expect(onActivate).toHaveBeenLastCalledWith("c");
    // The row's own scroll doesn't run under it, nor the sidebar's swipe.
    expect(move.defaultPrevented).toBe(true);
    const { swipeClaimed } = await import("../../../utils/gesture");
    expect(swipeClaimed()).toBe(true);
    touch(getByTestId("pill"), "touchstart", 10);
    expect(swipeClaimed()).toBe(false);
    rerender(<Row active="b" onActivate={onActivate} />);
    swipe(getByTestId("pill"), 100, 200);
    expect(onActivate).toHaveBeenLastCalledWith("a");
  });

  it("stops at either end, and leaves short or steep moves alone", () => {
    const onActivate = vi.fn();
    const { getByTestId } = render(<Row active="c" onActivate={onActivate} />);
    swipe(getByTestId("pill"), 200, 100);
    swipe(getByTestId("pill"), 100, 120);
    swipe(getByTestId("pill"), 100, 160, 120);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("leaves a lifted tab's drag alone", () => {
    const onActivate = vi.fn();
    const { getByTestId } = render(<Row active="a" onActivate={onActivate} />);
    getByTestId("pill").classList.add("tab-pill-lifted");
    swipe(getByTestId("pill"), 200, 100);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("takes a swipe begun over the row from what lies on it (the window bar)", () => {
    const onActivate = vi.fn();
    const { getByTestId } = render(<Row active="a" onActivate={onActivate} />);
    laidOut(getByTestId("row"));
    const over = document.body.appendChild(document.createElement("div"));
    swipe(over, 300, 200);
    expect(onActivate).toHaveBeenLastCalledWith("b");
    // Below the row it is the page's.
    touch(over, "touchstart", 300, 80);
    touch(over, "touchend", 200, 80);
    expect(onActivate).toHaveBeenCalledTimes(1);
    over.remove();
  });
});
