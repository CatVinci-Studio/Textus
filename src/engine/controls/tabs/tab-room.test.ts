// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fitTabs, measuresKey } from "./tab-room";

it("a tab row's measures are kept apart for each interface scale", () => {
  const bar = document.createElement("div");
  bar.className = "tab-bar";
  document.body.append(bar);
  const wide = measuresKey(bar);
  // A narrow window's step: the scale changes on no element's attribute.
  bar.style.setProperty("--chrome-scale", "calc(10 / 11)");
  expect(measuresKey(bar)).not.toBe(wide);
  bar.remove();
});

describe("a pinned tab's width", () => {
  const pill = {
    font: "13px sans-serif",
    textFix: 1,
    pad: 16,
    gap: 4,
    close: 16,
    closeIdle: true,
    dot: 6,
    lock: 12,
    waiting: 18,
    digit: 7,
    min: 0,
    max: 240,
    shrink: true,
    fewest: 28,
    outside: 0,
  };
  const room = { available: 2000, between: 2, list: 24, pill };
  it("holds its read-only lock and its waiting count as an unpinned one does", () => {
    const [plain, both] = fitTabs(
      [
        { title: "a.md", pinned: true },
        { title: "a.md", pinned: true, readOnly: true, waiting: 12 },
      ],
      room,
    ).widths;
    expect(both - plain).toBe(
      pill.lock + pill.gap + pill.waiting + pill.digit + pill.gap,
    );
  });
});
