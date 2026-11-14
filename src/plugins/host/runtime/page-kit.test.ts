// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import textRuntime from "./text.js?raw";
import pageKit from "./page-kit.js?raw";
import pageTools from "./page-tools.js?raw";

type PageApi = {
  language: string;
  t: (key: string) => string;
  dates: { format: (d: Date, form: string, language: string) => string };
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
  ) => { date: string; day: number; inMonth: boolean }[];
  pickDate: (value: string | null, anchor: Element) => Promise<string | null>;
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

  it("lays out a month from the language's first weekday", () => {
    const days = page().monthDays(2026, 10);
    expect(days).toHaveLength(42);
    // November 2026 starts on a Sunday; English weeks start on Sunday.
    expect(days[0]).toMatchObject({ date: "2026-11-01", inMonth: true });
    expect(days.filter((d) => d.inMonth)).toHaveLength(30);
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

    pointer("pointerdown", 50, items[2]);
    pointer("pointermove", 10);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
});
