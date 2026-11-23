// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TEXT_RUNTIME as textRuntime } from "../text-runtime";
import pageKit from "./page-kit.js?raw";
import pageTools from "./page-tools.js?raw";
import pageDrag from "./page-drag.js?raw";

type PageApi = {
  language: string;
  t: (key: string) => string;
  dates: {
    format: (
      d: Date | number | string,
      form?: string,
      options?: { language?: string } | string,
    ) => string;
  };
  drag: {
    reorder: (
      container: Element,
      options: {
        items: string;
        axis?: "x" | "y";
        onDrop: (a: number, b: number) => void;
      },
    ) => { dispose(): void };
  };
  monthDays: (
    year: number,
    month: number,
    options?: { weekStart?: number },
  ) => { date: string; day: number; inMonth: boolean }[];
  pickDate: (value: string | null, anchor: Element) => Promise<string | null>;
  resizeHandle: (
    handle: Element,
    options: {
      get: () => number;
      set: (n: number) => void;
      done?: (n: number) => void;
    },
  ) => unknown;
};
const page = () => (window as unknown as { textus: PageApi }).textus;
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeAll(() => {
  (window as unknown as { textus: Partial<PageApi> }).textus = {
    language: "en",
    t: (key: string) => `«${key}»`,
  };
  for (const code of [textRuntime, pageKit, pageTools, pageDrag])
    (0, eval)(code);
});

describe("what every plugin page gets", () => {
  it("fills [data-t] and names [data-t-label], also for what comes later", async () => {
    document.body.innerHTML = `<button data-t-label="close">×</button>`;
    await settle();
    const button = document.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("«close»");
    expect(button.getAttribute("data-tooltip")).toBe("«close»");
    const span = document.createElement("span");
    span.setAttribute("data-t", "title");
    document.body.append(span);
    await settle();
    expect(span.textContent).toBe("«title»");

    // Rows added one by one are read once each, not the list per row.
    const t = vi.spyOn(page(), "t");
    const list = document.createElement("ul");
    document.body.append(list);
    for (let i = 0; i < 30; i++) {
      const li = document.createElement("li");
      li.setAttribute("data-t", "row");
      list.append(li);
    }
    await settle();
    expect(t.mock.calls.filter(([key]) => key === "row").length).toBe(30);
    t.mockRestore();
  });

  it("makes a switch one tab stop, the arrows choosing in it", async () => {
    document.body.innerHTML = `<div class="tx-segmented">
      <button aria-checked="false">A</button>
      <button aria-checked="true">B</button>
      <button aria-checked="false">C</button></div>`;
    await settle();
    const [a, b, c] = [...document.querySelectorAll("button")];
    expect([a.tabIndex, b.tabIndex, c.tabIndex]).toEqual([-1, 0, -1]);
    const clicked = vi.fn();
    c.addEventListener("click", clicked);
    b.focus();
    b.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(document.activeElement).toBe(c);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("chooses only a tab row's tabs with the arrows, never the + beside them", () => {
    document.body.innerHTML = `<div class="tx-segmented" role="tablist">
      <button role="tab" aria-selected="false">A</button>
      <button role="tab" aria-selected="true">B</button>
      <button class="add">+</button></div>`;
    const [, b] = document.querySelectorAll<HTMLButtonElement>("[role=tab]");
    const add = document.querySelector<HTMLButtonElement>(".add")!;
    const added = vi.fn();
    add.addEventListener("click", added);
    b!.focus();
    b!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(added).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toBe("A");
  });

  it("formats dates as the host's textus.dates does", () => {
    const { format } = page().dates;
    expect(format("2026-11-14")).toBe("2026-11-14");
    expect(format(new Date(2026, 10, 14), "MMMM", { language: "de" })).toBe(
      "November",
    );
    expect(format(new Date(2026, 2, 1), "MMMM", "de")).toBe("März");
  });

  it("lays out a month from the language's first weekday", () => {
    const days = page().monthDays(2026, 10);
    expect(days).toHaveLength(42);
    // November 2026 starts on a Sunday; English weeks start on Sunday.
    expect(days[0]).toMatchObject({ date: "2026-11-01", inMonth: true });
    expect(days.filter((d) => d.inMonth)).toHaveLength(30);
    // A vault whose weeks start on Monday: the Monday before.
    expect(page().monthDays(2026, 10, { weekStart: 1 })[0]).toMatchObject({
      date: "2026-10-26",
      inMonth: false,
    });
  });

  it("keeps a dragged item under the pointer in a zoomed page", async () => {
    document.body.innerHTML = `<ul><li>a</li><li>b</li></ul>`;
    const items = [...document.querySelectorAll("li")];
    items.forEach((li, i) => {
      // Drawn at twice its own size.
      li.getBoundingClientRect = () =>
        ({ top: i * 40, height: 40, left: 0, width: 200 }) as DOMRect;
      Object.defineProperty(li, "offsetHeight", { value: 20 });
    });
    const handle = page().drag.reorder(document.querySelector("ul")!, {
      items: "li",
      onDrop: () => {},
    });
    const pointer = (type: string, y: number, target: EventTarget = window) =>
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          clientY: y,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    pointer("pointerdown", 10, items[0]);
    pointer("pointermove", 30);
    expect(items[0].style.transform).toBe("translateY(10px)");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    handle.dispose();
    // The release's click it swallows goes with the next tick.
    await settle();
  });

  it("picks a date on a month under a button", async () => {
    document.body.innerHTML = `<button id="at">Date</button>`;
    const picked = page().pickDate(
      "2026-11-14",
      document.getElementById("at")!,
    );
    const day = document.querySelector<HTMLButtonElement>(
      '.tx-popover [aria-label="2026-11-20"]',
    )!;
    expect(
      document
        .querySelector('.tx-popover [aria-selected="true"]')!
        .getAttribute("aria-label"),
    ).toBe("2026-11-14");
    day.click();
    await expect(picked).resolves.toBe("2026-11-20");
    expect(document.querySelector(".tx-popover")).toBeNull();

    // A page that clears itself while the month is open still gets an answer.
    const gone = page().pickDate(null, document.getElementById("at")!);
    document.body.textContent = "";
    document.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await expect(gone).resolves.toBeNull();
  });

  it("ends a resize the browser takes back for a pan", () => {
    document.body.innerHTML = `<div id="h"></div>`;
    let size = 100;
    const done = vi.fn();
    page().resizeHandle(document.getElementById("h")!, {
      get: () => size,
      set: (n) => (size = n),
      done,
    });
    const pointer = (type: string, x: number, target: EventTarget = window) =>
      target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, clientX: x, button: 0 }),
      );
    pointer("pointerdown", 10, document.getElementById("h")!);
    pointer("pointermove", 30);
    pointer("pointercancel", 30);
    expect(done).toHaveBeenCalledWith(120);
    pointer("pointermove", 80);
    expect(size).toBe(120);
  });

  it("gives a dragged list's item its new place, Esc none", () => {
    document.body.innerHTML = `<ul><li>a</li><li>b</li><li>c</li></ul>`;
    const items = [...document.querySelectorAll("li")];
    items.forEach((li, i) => {
      li.getBoundingClientRect = () =>
        ({ top: i * 20, height: 20, left: 0, width: 100 }) as DOMRect;
    });
    const onDrop = vi.fn();
    page().drag.reorder(document.querySelector("ul")!, {
      items: "li",
      onDrop,
    });
    const pointer = (type: string, y: number, target: EventTarget = window) =>
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          clientY: y,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    pointer("pointerdown", 10, items[0]);
    pointer("pointermove", 30);
    pointer("pointermove", 55);
    expect(items[0].classList.contains("is-drag-lifted")).toBe(true);
    pointer("pointerup", 55);
    expect(onDrop).toHaveBeenCalledWith(0, 2);
    // Put in its place at once, not left to spring back.
    expect(
      [...document.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual(["b", "c", "a"]);

    pointer("pointerdown", 50, items[2]);
    pointer("pointermove", 10);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("lifts an item under a finger held still, and leaves a moving finger to scroll", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<ul><li>a</li><li>b</li><li>c</li></ul>`;
    const items = [...document.querySelectorAll("li")];
    items.forEach((li, i) => {
      li.getBoundingClientRect = () =>
        ({ top: 100 + i * 20, height: 20, left: 0, width: 100 }) as DOMRect;
    });
    const onDrop = vi.fn();
    const handle = page().drag.reorder(document.querySelector("ul")!, {
      items: "li",
      onDrop,
    });
    const finger = (type: string, y: number, target: EventTarget = window) => {
      const e = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientY: y,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
      });
      Object.assign(e, { pointerType: "touch", pointerId: 7 });
      target.dispatchEvent(e);
      return e;
    };
    const touchmove = () => {
      const e = new Event("touchmove", { bubbles: true, cancelable: true });
      document.querySelector("li")!.dispatchEvent(e);
      return e.defaultPrevented;
    };

    // A swipe: no lift, the page scrolls.
    finger("pointerdown", 110, items[0]);
    finger("pointermove", 150);
    expect(touchmove()).toBe(false);
    vi.advanceTimersByTime(600);
    expect(items[0].classList.contains("is-drag-lifted")).toBe(false);
    finger("pointerup", 150);

    // Held still, it lifts; the page then stays put under the drag.
    finger("pointerdown", 110, items[0]);
    vi.advanceTimersByTime(600);
    expect(items[0].classList.contains("is-drag-lifted")).toBe(true);
    const menu = new MouseEvent("contextmenu", { cancelable: true });
    window.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(touchmove()).toBe(true);
    finger("pointermove", 125);
    finger("pointermove", 155);
    finger("pointerup", 155);
    expect(onDrop).toHaveBeenCalledWith(0, 2);
    expect(touchmove()).toBe(false);
    expect(document.body.style.userSelect).toBe("");

    // Drawn anew while held: nothing lifts, and the page selects again.
    const [first] = document.querySelectorAll("li");
    finger("pointerdown", 110, first);
    first.remove();
    vi.advanceTimersByTime(600);
    expect(document.body.style.userSelect).toBe("");
    handle.dispose();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("scrolls the list's scroller while a dragged item rests at its edge", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => {
      frames.push(fn);
      return frames.length;
    });
    document.body.innerHTML = `<div id="s" style="overflow-y: auto"><ul><li>a</li><li>b</li><li>c</li></ul></div>`;
    const scroller = document.getElementById("s")!;
    Object.defineProperty(scroller, "scrollHeight", { value: 600 });
    Object.defineProperty(scroller, "clientHeight", { value: 200 });
    scroller.getBoundingClientRect = () =>
      ({ top: 0, bottom: 200, left: 0, right: 100 }) as DOMRect;
    const items = [...document.querySelectorAll("li")];
    items.forEach((li, i) => {
      li.getBoundingClientRect = () =>
        ({ top: 60 + i * 20, height: 20, left: 0, width: 100 }) as DOMRect;
    });
    const handle = page().drag.reorder(document.querySelector("ul")!, {
      items: "li",
      onDrop: () => {},
    });
    const pointer = (type: string, y: number, target: EventTarget = window) =>
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          clientY: y,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    pointer("pointerdown", 70, items[0]);
    pointer("pointermove", 195);
    frames.shift()!(0);
    expect(scroller.scrollTop).toBeGreaterThan(0);
    // The item stays under the pointer, the scroll counted.
    expect(items[0].style.transform).toBe(
      `translateY(${125 + scroller.scrollTop}px)`,
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    // At the slowest pace on a 144 Hz screen it still goes, a pixel every
    // few frames: as far in a second as at 60 Hz.
    scroller.scrollTop = 0;
    frames.length = 0;
    pointer("pointerdown", 70, items[0]);
    pointer("pointermove", 165);
    for (let now = 0; now <= 1000 && frames.length; now += 1000 / 144)
      frames.shift()!(now);
    expect(scroller.scrollTop).toBeGreaterThan(50);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    handle.dispose();
    vi.restoreAllMocks();
  });

  it("drops where a drag is when its release went unheard, and a new press ends it", () => {
    document.body.innerHTML = `<ul><li>a</li><li>b</li><li>c</li></ul>`;
    const items = [...document.querySelectorAll("li")];
    items.forEach((li, i) => {
      li.getBoundingClientRect = () =>
        ({ top: i * 20, height: 20, left: 0, width: 100 }) as DOMRect;
    });
    const onDrop = vi.fn();
    const handle = page().drag.reorder(document.querySelector("ul")!, {
      items: "li",
      onDrop,
    });
    const pointer = (
      type: string,
      y: number,
      target: EventTarget = window,
      buttons = 1,
    ) =>
      target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, clientY: y, button: 0, buttons }),
      );
    // WebView2 missed the release: the next move has no button down.
    pointer("pointerdown", 10, items[0]);
    pointer("pointermove", 45);
    pointer("pointermove", 45, window, 0);
    expect(onDrop).toHaveBeenCalledWith(0, 1);
    expect(items[0].classList.contains("is-drag-lifted")).toBe(false);

    pointer("pointerdown", 10, items[1]);
    pointer("pointermove", 45);
    expect(items[1].classList.contains("is-drag-lifted")).toBe(true);
    pointer("pointerdown", 100, document.body);
    expect(items[1].classList.contains("is-drag-lifted")).toBe(false);
    expect(onDrop).toHaveBeenCalledTimes(1);
    handle.dispose();
  });

  it("gives the page its own selection back, and leaves a text field's press to it", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<ul><li>a <input></li><li>b</li><li>c <input type="checkbox"></li></ul>`;
    document.body.style.userSelect = "text";
    const items = [...document.querySelectorAll("li")];
    items.forEach((li, i) => {
      li.getBoundingClientRect = () =>
        ({ top: i * 20, height: 20, left: 0, width: 100 }) as DOMRect;
    });
    const onDrop = vi.fn();
    const handle = page().drag.reorder(document.querySelector("ul")!, {
      items: "li",
      onDrop,
    });
    const finger = (type: string, y: number, target: EventTarget = window) => {
      const e = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientY: y,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
      });
      Object.assign(e, { pointerType: "touch", pointerId: 3 });
      target.dispatchEvent(e);
    };
    // A tap.
    finger("pointerdown", 30, items[1]);
    finger("pointerup", 30);
    expect(document.body.style.userSelect).toBe("text");
    // A hold and a drag.
    finger("pointerdown", 30, items[1]);
    vi.advanceTimersByTime(600);
    expect(document.body.style.userSelect).toBe("none");
    finger("pointermove", 55);
    finger("pointerup", 55);
    expect(onDrop).toHaveBeenCalledWith(1, 2);
    expect(document.body.style.userSelect).toBe("text");
    // Held on a text field: its own long press (select, the menu).
    finger("pointerdown", 10, document.querySelector("input")!);
    vi.advanceTimersByTime(600);
    expect(items[0].classList.contains("is-drag-lifted")).toBe(false);
    expect(document.body.style.userSelect).toBe("text");
    finger("pointerup", 10);
    // A checkbox is no text field: held, its item lifts.
    finger("pointerdown", 50, document.querySelector("[type=checkbox]")!);
    vi.advanceTimersByTime(600);
    expect(items[2].classList.contains("is-drag-lifted")).toBe(true);
    finger("pointerup", 50);
    document.body.style.userSelect = "";
    handle.dispose();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });
});
