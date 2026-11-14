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

function swipe(el: Element, from: number, to: number, toY = 20) {
  touch(el, "touchstart", from);
  const move = touch(el, "touchmove", (from + to) / 2, (20 + toY) / 2);
  touch(el, "touchend", to, toY);
  return move;
}

describe("swiping the tab row", () => {
  it("brings the next tab forward on a swipe left, the one before on a swipe right", () => {
    const onActivate = vi.fn();
    const { getByTestId, rerender } = render(
      <Row active="b" onActivate={onActivate} />,
    );
    const move = swipe(getByTestId("pill"), 200, 100);
    expect(onActivate).toHaveBeenLastCalledWith("c");
    // The row's own scroll doesn't run under it.
    expect(move.defaultPrevented).toBe(true);
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
});
