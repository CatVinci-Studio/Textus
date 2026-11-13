import { describe, expect, it } from "vitest";
import { leadEndLength, rowInsets } from "./row-insets";

describe("rowInsets", () => {
  const row = { left: 100, right: 700 };
  it("starts the first tab at its sheet's edge where the bar's controls leave room", () => {
    expect(rowInsets(row, 80, 900, 8, 20)).toEqual({
      start: 0,
      end: 20,
      atCorner: true,
    });
  });
  it("else clears the controls, and the sheet's corner with the tab's curve", () => {
    // The controls end past the sheet's edge: past them.
    expect(rowInsets(row, 130, 900, 8, 20).start).toBe(38);
    // Barely past it: past the corner instead, never into its curve.
    expect(rowInsets(row, 105, 900, 8, 20)).toMatchObject({
      start: 20,
      atCorner: false,
    });
  });
  it("takes controls wholly before the row as no obstacle", () => {
    // The app menu in the rail's column, beside a flush classic sheet.
    expect(rowInsets(row, 95, 900, 8, 20)).toMatchObject({
      start: 0,
      atCorner: true,
    });
  });
  it("ends clear of the bar's status, or of the corner", () => {
    expect(rowInsets(row, 0, 650, 8, 20).end).toBe(58);
    expect(rowInsets(row, 0, 900, 8, 20).end).toBe(20);
  });
  it("keeps bare bar to move the window by before its controls only", () => {
    expect(rowInsets(row, 0, 650, 8, 20, 56).end).toBe(114);
    // A row that ends before the controls has none to keep.
    expect(rowInsets(row, 0, 900, 8, 20, 56).end).toBe(20);
  });
});

describe("leadEndLength", () => {
  it("gives the end of the bar's leading controls, rounded up", () => {
    expect(leadEndLength(118.2)).toBe("119px");
  });

  it("is zero with no leading controls", () => {
    expect(leadEndLength(-Infinity)).toBe("0px");
  });
});
