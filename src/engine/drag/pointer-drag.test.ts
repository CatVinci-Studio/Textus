// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { holdToDrag } from "./hold-drag";
import { trackDrag } from "./pointer-drag";
import { passedCount, shiftAt } from "./row";

// Four items 36 wide, 4 apart: centres 20, 60, 100, 140.
const centersWithout = (i: number) =>
  [20, 60, 100, 140].filter((_, j) => j !== i);

it("drops where the dragged item's center has passed the others", () => {
  expect(passedCount(centersWithout(0), 20)).toBe(0);
  expect(passedCount(centersWithout(0), 20 + 45)).toBe(1);
  expect(passedCount(centersWithout(0), 20 + 200)).toBe(3);
  expect(passedCount(centersWithout(3), 140 - 90)).toBe(1);
});

it("moves each passed item one slot the other way", () => {
  // The first dragged past two: those two step back.
  const to = passedCount(centersWithout(0), 20 + 85);
  expect([0, 1, 2].map((i) => shiftAt(i, 0, to, 40))).toEqual([-40, -40, 0]);
  // The last dragged back past one: it steps on.
  const back = passedCount(centersWithout(3), 140 - 50);
  expect([0, 1, 2].map((i) => shiftAt(i, 3, back, 40))).toEqual([0, 0, 40]);
});

// A held button while moving, none after (WebView2 may skip the release).
const pointer = (type: string, x: number, y = 0, buttons = 1) =>
  window.dispatchEvent(
    Object.assign(
      new MouseEvent(type, {
        clientX: x,
        clientY: y,
        buttons: type === "pointerup" ? 0 : buttons,
      }),
      { pointerId: 1 },
    ),
  );

it("starts only past the threshold, drops on release, not on Esc", () => {
  const end = vi.fn();
  const move = vi.fn();
  trackDrag({ button: 0, clientX: 0, clientY: 0 }, { move, end });
  pointer("pointermove", 2);
  expect(move).not.toHaveBeenCalled();
  pointer("pointermove", 30);
  pointer("pointerup", 30);
  expect(end).toHaveBeenCalledWith(30, 0, true, expect.any(MouseEvent));

  const end2 = vi.fn();
  trackDrag({ button: 0, clientX: 0, clientY: 0 }, { move, end: end2 });
  pointer("pointermove", 30);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(end2).toHaveBeenCalledWith(0, 0, false, undefined);
});

it("swallows the click a drag's release sends", () => {
  const clicked = vi.fn();
  document.body.addEventListener("click", clicked);
  trackDrag({ button: 0, clientX: 0, clientY: 0 }, { move() {}, end() {} });
  pointer("pointermove", 30);
  pointer("pointerup", 30);
  document.body.click();
  expect(clicked).not.toHaveBeenCalled();
  document.body.removeEventListener("click", clicked);
});

it("drops when the buttons are found up, and from the first move once handed over", () => {
  const end = vi.fn();
  const move = vi.fn();
  const handle = trackDrag(
    { button: -1, clientX: 0, clientY: 0 },
    { move, end },
    { started: true },
  );
  pointer("pointermove", 1);
  expect(move).toHaveBeenCalledWith(1, 0, expect.any(MouseEvent));
  pointer("pointermove", 9, 0, 0);
  expect(end).toHaveBeenCalledWith(9, 0, true, expect.any(MouseEvent));
  // Over already: cancelling does nothing more.
  handle.cancel();
  expect(end).toHaveBeenCalledTimes(1);
  const end2 = vi.fn();
  const again = trackDrag(
    { button: 0, clientX: 0, clientY: 0 },
    { move: () => {}, end: end2 },
    { started: true },
  );
  pointer("pointermove", 4);
  again.cancel();
  expect(end2).toHaveBeenCalledWith(4, 0, false, undefined);
});

it("follows a finger whose pressed node left the page, its moves held", () => {
  const pill = document.createElement("div");
  document.body.append(pill);
  const end = vi.fn();
  const move = vi.fn();
  trackDrag({ button: 0, clientX: 0, clientY: 0, target: pill }, { move, end });
  pointer("pointermove", 30);
  pill.remove();
  const at = (type: string, x: number) =>
    pill.dispatchEvent(
      Object.assign(
        new MouseEvent(type, { clientX: x, buttons: 1, bubbles: true }),
        { pointerId: 1 },
      ),
    );
  at("pointermove", 60);
  expect(move).toHaveBeenLastCalledWith(60, 0, expect.any(MouseEvent));
  const pan = new Event("touchmove", { cancelable: true });
  pill.dispatchEvent(pan);
  expect(pan.defaultPrevented).toBe(true);
  at("pointerup", 80);
  expect(end).toHaveBeenCalledTimes(1);
  expect(end).toHaveBeenCalledWith(80, 0, true, expect.any(MouseEvent));
  // Heard once, though an attached node's events reach the window too.
  const twice = vi.fn();
  const row = document.createElement("div");
  document.body.append(row);
  trackDrag(
    { button: 0, clientX: 0, clientY: 0, target: row },
    { move: twice, end() {} },
  );
  row.dispatchEvent(
    Object.assign(
      new MouseEvent("pointermove", { clientX: 40, buttons: 1, bubbles: true }),
      { pointerId: 1 },
    ),
  );
  expect(twice).toHaveBeenCalledTimes(1);
  pointer("pointerup", 40);
  row.remove();

  // A release never heard: the next press ends it, dropping nothing.
  const lost = vi.fn();
  trackDrag({ button: 0, clientX: 0, clientY: 0 }, { move() {}, end: lost });
  pointer("pointermove", 50);
  pointer("pointerdown", 200);
  expect(lost).toHaveBeenCalledWith(50, 0, false, expect.any(MouseEvent));
});

it("keeps a long press's menu from taking the touch over while it follows a press", () => {
  const menu = () => {
    const e = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(e);
    return e.defaultPrevented;
  };
  trackDrag({ button: 0, clientX: 0, clientY: 0 }, { move() {}, end() {} });
  pointer("pointermove", 30);
  expect(menu()).toBe(true);
  pointer("pointerup", 30);
  expect(menu()).toBe(false);
});

it("lets a second finger landing during a hold take the touch back", () => {
  vi.useFakeTimers();
  const lift = vi.fn();
  const finger = (type: string, id: number) =>
    window.dispatchEvent(
      Object.assign(new MouseEvent(type, { buttons: 1 }), {
        pointerId: id,
        pointerType: "touch",
      }),
    );
  const down = Object.assign(new MouseEvent("pointerdown", { buttons: 1 }), {
    pointerId: 1,
    pointerType: "touch",
  }) as unknown as PointerEvent;
  holdToDrag(down, { lift, move() {}, end() {} });
  finger("pointerdown", 2);
  vi.advanceTimersByTime(600);
  expect(lift).not.toHaveBeenCalled();

  // One finger held still lifts.
  holdToDrag(down, { lift, move() {}, end() {} });
  vi.advanceTimersByTime(600);
  expect(lift).toHaveBeenCalledTimes(1);
  finger("pointerup", 1);
  vi.useRealTimers();
});
