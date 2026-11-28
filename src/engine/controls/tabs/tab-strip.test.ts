import { describe, expect, it } from "vitest";
import { slides, type RowShape } from "./tab-strip";

const row = (more: Partial<RowShape> = {}): RowShape => ({
  ids: ["a", "b", "c"],
  widths: [120, 100, 90],
  room: 600,
  gap: 4,
  ...more,
});

describe("slides", () => {
  it("slides a row whose tabs came, went or moved", () => {
    expect(slides(row(), row({ ids: ["a", "b"], widths: [120, 100] }))).toBe(
      true,
    );
    expect(slides(row(), row({ ids: ["b", "a", "c"] }))).toBe(true);
  });

  it("slides a tab whose own width changed in the same room, and those after it", () => {
    // Settings' tab named for the page it shows: General, then Appearance.
    expect(slides(row(), row({ widths: [120, 165, 90] }))).toBe(true);
  });

  it("slides a renamed tab even as the room changes with it", () => {
    expect(slides(row(), row({ room: 400, widths: [120, 165, 90] }))).toBe(
      true,
    );
  });

  it("lands at once tabs squeezed to a room that changed, as the window or an island does", () => {
    const squeezed = row({ room: 318, widths: [110, 100, 100] });
    expect(slides(squeezed, row({ room: 288, widths: [100, 90, 90] }))).toBe(
      false,
    );
  });

  it("leaves a row that did not change where it is", () => {
    expect(slides(row(), row())).toBe(false);
  });
});
