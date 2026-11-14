import { describe, expect, it } from "vitest";
import { leadClearLength, rowInsets } from "./row-insets";

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
  it("lets the grip give way so a narrow row still holds a tab", () => {
    // 360 wide, the status 200 into it: the grip shrinks to leave 132.
    const narrow = { left: 388, right: 748 };
    const { start, end } = rowInsets(narrow, 0, 548, 8, 20, 62, 132);
    expect(narrow.right - narrow.left - start - end).toBe(132);
    // With room to spare it keeps all of it.
    expect(rowInsets(row, 0, 650, 8, 20, 56, 132).end).toBe(114);
  });
});

// Nothing in the bar's row lands on another: across every place the
// controls and the row can be, the tabs keep clear of both ends.
describe("the bar's row, swept", () => {
  it("never puts a tab under the leading controls or the status", () => {
    const air = 8;
    const corner = 20;
    for (let left = 0; left <= 400; left += 50)
      for (let width = 120; width <= 900; width += 120)
        for (let lead = -40; lead <= 500; lead += 30)
          for (let status = 200; status <= 1400; status += 140) {
            const row = { left, right: left + width };
            const { start, end } = rowInsets(
              row,
              lead,
              status,
              air,
              corner,
              56,
            );
            const first = row.left + start;
            const last = row.right - end;
            if (lead > row.left)
              expect(first).toBeGreaterThanOrEqual(lead + air);
            if (status < row.right)
              expect(last).toBeLessThanOrEqual(status - air);
            expect(start).toBeGreaterThanOrEqual(0);
            expect(end).toBeGreaterThanOrEqual(corner);
          }
  });
});

describe("leadClearLength", () => {
  it("starts a name past the bar's leading controls and the room after them", () => {
    expect(leadClearLength(118.2, 16)).toBe("135px");
    for (let lead = 1; lead < 400; lead += 7)
      expect(parseFloat(leadClearLength(lead, 16))).toBeGreaterThanOrEqual(
        lead + 16,
      );
  });

  it("is zero with no leading controls", () => {
    expect(leadClearLength(-Infinity, 16)).toBe("0px");
  });
});
