// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import pageDragCore from "./page-drag-core.js?raw";
import pageDrag from "./page-drag.js?raw";

/** textus.drag's track and sortable (API 1.12): the rules every drag in
 *  Textus keeps, for a mouse and a finger, and an item among lists. */

type Handlers = {
  start?: (x: number, y: number) => unknown;
  move: (x: number, y: number) => void;
  end: (x: number, y: number, dropped: boolean) => void;
  held?: (x: number, y: number) => void;
};
type Drag = {
  track: (
    down: PointerEvent,
    handlers: Handlers,
    options?: { hold?: boolean },
  ) => { cancel(): void };
  sortable: (
    down: PointerEvent,
    options: {
      item: Element;
      lists: () => Element[];
      itemsOf: (list: Element) => Element[];
      onDrop: (list: Element, index: number) => void;
      axis?: "x" | "y";
    },
  ) => { cancel(): void };
  reorder: unknown;
};
const drag = () =>
  (window as unknown as { textus: { drag: Drag } }).textus.drag;

beforeAll(() => {
  (window as unknown as { textus: object }).textus = {};
  for (const code of [pageDragCore, pageDrag]) (0, eval)(code);
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** A press, move or release; a finger's are pointer 7's. */
function pointer(
  type: string,
  x: number,
  y: number,
  kind: "mouse" | "touch" = "mouse",
  extra: Record<string, unknown> = {},
) {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
  });
  Object.assign(e, { pointerType: kind, pointerId: 7, ...extra });
  return e as unknown as PointerEvent;
}
const fire = (type: string, x: number, y: number, kind?: "mouse" | "touch") =>
  window.dispatchEvent(pointer(type, x, y, kind));

function recorder() {
  const calls: string[] = [];
  const handlers: Handlers = {
    start: (x, y) => void calls.push(`start ${x},${y}`),
    move: (x, y) => void calls.push(`move ${x},${y}`),
    end: (x, y, dropped) => void calls.push(`end ${x},${y} ${dropped}`),
    held: (x, y) => void calls.push(`held ${x},${y}`),
  };
  return { calls, handlers };
}

describe("a mouse", () => {
  it("drags once it moves 5 px, and Esc puts it back", () => {
    const { calls, handlers } = recorder();
    drag().track(pointer("pointerdown", 10, 10), handlers);
    fire("pointermove", 13, 10);
    expect(calls).toEqual([]);
    fire("pointermove", 20, 10);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    );
    expect(calls).toEqual(["start 10,10", "move 20,10", "end 10,10 false"]);
    expect(document.body.style.userSelect).toBe("");
  });

  it("ends where it is when start says what it would lift is gone", () => {
    const calls: string[] = [];
    drag().track(pointer("pointerdown", 10, 10), {
      start: () => false,
      move: () => void calls.push("move"),
      end: () => void calls.push("end"),
    });
    fire("pointermove", 30, 10);
    fire("pointerup", 30, 10);
    expect(calls).toEqual([]);
    expect(document.body.style.userSelect).toBe("");
  });
});

describe("a finger", () => {
  it("that moves before it has held still scrolls, and drags nothing", () => {
    vi.useFakeTimers();
    const { calls, handlers } = recorder();
    drag().track(pointer("pointerdown", 100, 100, "touch"), handlers);
    fire("pointermove", 100, 130, "touch");
    vi.advanceTimersByTime(1000);
    fire("pointerup", 100, 160, "touch");
    expect(calls).toEqual([]);
    expect(document.body.style.userSelect).toBe("");
  });

  it("held still lifts and drags; let go where it was, it is a long press", () => {
    vi.useFakeTimers();
    const a = recorder();
    drag().track(pointer("pointerdown", 100, 100, "touch"), a.handlers);
    vi.advanceTimersByTime(300);
    const touch = new Event("touchmove", { cancelable: true });
    window.dispatchEvent(touch);
    expect(touch.defaultPrevented).toBe(true);
    fire("pointermove", 100, 140, "touch");
    fire("pointerup", 100, 140, "touch");
    expect(a.calls).toEqual([
      "start 100,100",
      "move 100,140",
      "end 100,140 true",
    ]);

    const b = recorder();
    drag().track(pointer("pointerdown", 100, 100, "touch"), b.handlers);
    vi.advanceTimersByTime(300);
    fire("pointerup", 101, 100, "touch");
    expect(b.calls).toEqual([
      "start 100,100",
      "end 101,100 false",
      "held 101,100",
    ]);
  });

  it("joined by a second finger before it has held still is a pinch", () => {
    vi.useFakeTimers();
    const { calls, handlers } = recorder();
    drag().track(pointer("pointerdown", 100, 100, "touch"), handlers);
    window.dispatchEvent(
      pointer("pointerdown", 200, 200, "touch", { pointerId: 8 }),
    );
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([]);
  });
});

describe("an item among lists", () => {
  it("moves into the list let go over, and says where", () => {
    document.body.innerHTML = `<ul id="a"><li>1</li><li>2</li></ul><ul id="b"><li>3</li></ul>`;
    const [a, b] = Array.from(document.querySelectorAll("ul"));
    const box = (el: Element, left: number, top: number, h: number) =>
      (el.getBoundingClientRect = () =>
        ({
          left,
          top,
          width: 100,
          height: h,
          right: left + 100,
          bottom: top + h,
        }) as DOMRect);
    box(a, 0, 0, 100);
    box(b, 200, 0, 100);
    const [one, two, three] = Array.from(document.querySelectorAll("li"));
    box(one, 0, 0, 20);
    box(two, 0, 20, 20);
    box(three, 200, 0, 20);
    const onDrop = vi.fn();
    drag().sortable(pointer("pointerdown", 10, 10), {
      item: one,
      lists: () => [a, b],
      itemsOf: (list) => Array.from(list.querySelectorAll("li")),
      onDrop,
    });
    fire("pointermove", 250, 50);
    expect(document.querySelector(".tx-drag-ghost")).not.toBeNull();
    fire("pointerup", 250, 50);
    expect(onDrop).toHaveBeenCalledWith(b, 1);
    expect(one.parentNode).toBe(b);
    expect(document.querySelector(".tx-drag-ghost")).toBeNull();
  });

  it("goes home when Esc puts it back", () => {
    document.body.innerHTML = `<ul id="a"><li>1</li><li>2</li></ul><ul id="b"></ul>`;
    const [a, b] = Array.from(document.querySelectorAll("ul"));
    b.getBoundingClientRect = () =>
      ({
        left: 200,
        top: 0,
        right: 300,
        bottom: 100,
        width: 100,
        height: 100,
      }) as DOMRect;
    const [one] = Array.from(document.querySelectorAll("li"));
    const onDrop = vi.fn();
    drag().sortable(pointer("pointerdown", 10, 10), {
      item: one,
      lists: () => [a, b],
      itemsOf: (list) => Array.from(list.querySelectorAll("li")),
      onDrop,
    });
    fire("pointermove", 250, 50);
    expect(one.parentNode).toBe(b);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDrop).not.toHaveBeenCalled();
    expect(a.firstElementChild).toBe(one);
  });

  it("keeps its core's own parts off the API", () => {
    expect(Object.keys(drag()).sort()).toEqual([
      "indexAt",
      "reorder",
      "sortable",
      "track",
    ]);
  });
});
