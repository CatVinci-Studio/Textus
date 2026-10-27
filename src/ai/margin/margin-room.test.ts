import { describe, expect, it } from "vitest";
import { marginRoom } from "./margin-room";

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
    expect(room.shift).toBe(92);
    // What's left right of the moved text is one card and its air.
    expect(1000 - (room.textRight - room.shift)).toBe(276);
  });

  it("has no margin below about 924px of editor, the column moved or not", () => {
    expect(marginRoom(924, COLUMN, PADDING).available).toBe(true);
    expect(marginRoom(923, COLUMN, PADDING).available).toBe(false);
  });

  it("has no margin when the column fills the editor", () => {
    expect(marginRoom(700, 700, PADDING).available).toBe(false);
  });
});
