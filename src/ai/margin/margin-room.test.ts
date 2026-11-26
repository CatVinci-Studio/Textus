// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  columnForMargin,
  marginRoom,
  useMarginAvailable,
  useTellMarginRoom,
} from "./margin-room";

// The "auto" text width: a 680px column at most widths, 1.5rem padding each
// side.
const COLUMN = 680;
const PADDING = 48;

describe("marginRoom", () => {
  it("leaves the column where it is when the margin already fits", () => {
    const room = marginRoom(1440, 806, PADDING);
    expect(room.available).toBe(true);
    expect(room.shift).toBe(0);
    expect(room.natural).toBe(317);
  });

  it("moves the column left just far enough to open the margin", () => {
    const room = marginRoom(1000, COLUMN, PADDING);
    expect(room.available).toBe(true);
    expect(room.shift).toBe(120);
    // What's left right of the moved text is one card and its air.
    expect(1000 - (room.textRight - room.shift)).toBe(304);
  });

  it("has no margin below about 954px of editor, the column moved or not", () => {
    expect(marginRoom(954, COLUMN, PADDING).available).toBe(true);
    expect(marginRoom(953, COLUMN, PADDING).available).toBe(false);
  });

  it("has no margin when the column fills the editor", () => {
    expect(marginRoom(700, 700, PADDING).available).toBe(false);
  });

  it("gives the column narrowed for cards its margin at every width and size", () => {
    // Interface sizes scale the card and the padding to fractions of a
    // pixel.
    const root = document.documentElement.style;
    for (const scale of ["1", "1.1", "1.0000000493"]) {
      root.setProperty("--ui-text-scale", scale);
      for (const padding of [PADDING, 88, 96.8])
        for (let width = 700; width < 1100; width += 0.5) {
          const column = columnForMargin(width, padding, 0);
          // Read back from the layout a hair off, as WebKit's sub-pixel
          // units give it.
          if (column !== null)
            expect(
              marginRoom(width, column + 0.00003, padding - 0.00003).available,
            ).toBe(true);
        }
    }
    root.removeProperty("--ui-text-scale");
  });
});

describe("useTellMarginRoom", () => {
  it("Settings hears the document in front, not the last to measure", () => {
    const front = renderHook((p) => useTellMarginRoom(p.inFront, p.no), {
      initialProps: { inFront: true, no: false },
    });
    const behind = renderHook((p) => useTellMarginRoom(p.inFront, p.no), {
      initialProps: { inFront: false, no: false },
    });
    const settings = renderHook(() => useMarginAvailable());
    // The other side of a split narrows after the one in front measured.
    behind.rerender({ inFront: false, no: true });
    expect(settings.result.current).toBe(true);
    // Brought to the front, it speaks for itself.
    act(() => {
      front.rerender({ inFront: false, no: false });
      behind.rerender({ inFront: true, no: true });
    });
    expect(settings.result.current).toBe(false);
  });
});
