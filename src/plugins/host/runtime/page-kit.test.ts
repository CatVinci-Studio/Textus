// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TEXT_RUNTIME as textRuntime } from "../text-runtime";
import pageKit from "./page-kit.js?raw";
import pageTools from "./page-tools.js?raw";

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
  for (const code of [textRuntime, pageKit, pageTools]) (0, eval)(code);
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
        new MouseEvent(type, { bubbles: true, clientY: y, button: 0 }),
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
        new MouseEvent(type, { bubbles: true, clientY: y, button: 0 }),
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
});
