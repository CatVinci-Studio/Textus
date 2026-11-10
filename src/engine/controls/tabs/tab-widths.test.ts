import { describe, expect, it } from "vitest";
import { tabWidths, type TabParts } from "./tab-widths";

const LIMITS = { min: 56, max: 200 };
/** Padding, a gap and the ×'s room. */
const FIXED = 40;
const tab = (title: number, fixed = FIXED): TabParts => ({ title, fixed });

describe("tabWidths", () => {
  it("gives each tab its name's width and its fixed parts when the row has room", () => {
    const fit = tabWidths([tab(60), tab(90)], LIMITS, 600, 2);
    expect(fit.widths).toEqual([100, 130]);
    expect(fit.cut).toEqual([false, false]);
    expect(fit.overflow).toBe(false);
  });

  it("keeps the ×'s room in every tab: a dot or a padlock adds to it, never replaces it", () => {
    const fit = tabWidths([tab(60), tab(60, FIXED + 14)], LIMITS, 600);
    expect(fit.widths).toEqual([100, 114]);
  });

  it("never makes a short name's tab narrower than the least a tab may be", () => {
    const fit = tabWidths([tab(4)], LIMITS, 600);
    expect(fit.widths).toEqual([56]);
    expect(fit.cut).toEqual([false]);
  });

  it("stops a long name's tab at the widest a tab may be, its name cut", () => {
    const fit = tabWidths([tab(400), tab(60)], LIMITS, 600);
    expect(fit.widths).toEqual([200, 100]);
    expect(fit.cut).toEqual([true, false]);
    expect(fit.overflow).toBe(false);
  });

  it("squeezed, the widest tabs give way first and a short one keeps its width", () => {
    // 100 + 180 + 180 wanted, 380 to share: the short one keeps 100.
    const fit = tabWidths([tab(60), tab(140), tab(140)], LIMITS, 380);
    expect(fit.widths).toEqual([100, 140, 140]);
    expect(fit.cut).toEqual([false, true, true]);
    expect(fit.overflow).toBe(false);
  });

  it("squeezed further, every tab shares the row evenly", () => {
    const fit = tabWidths([tab(60), tab(140), tab(140)], LIMITS, 240);
    expect(fit.widths).toEqual([80, 80, 80]);
    expect(fit.cut).toEqual([true, true, true]);
    expect(fit.overflow).toBe(false);
  });

  it("takes the gaps between tabs out of the row before sharing it", () => {
    const fit = tabWidths([tab(140), tab(140), tab(140)], LIMITS, 304, 2);
    expect(fit.widths).toEqual([100, 100, 100]);
  });

  it("past the narrowest a tab may be, the row overflows and the tabs stay that wide", () => {
    const fit = tabWidths([tab(140), tab(140), tab(140)], LIMITS, 150);
    expect(fit.widths).toEqual([56, 56, 56]);
    expect(fit.overflow).toBe(true);
  });

  it("never takes more than the row while it does not overflow", () => {
    for (let room = 170; room < 700; room += 7) {
      const tabs = [tab(30), tab(95), tab(300), tab(12, FIXED + 14)];
      const fit = tabWidths(tabs, LIMITS, room, 2);
      const taken = fit.widths.reduce((sum, width) => sum + width, 0) + 6;
      if (!fit.overflow) expect(taken).toBeLessThanOrEqual(room);
      else expect(fit.widths).toEqual([56, 56, 56, 56]);
    }
  });

  it("where tabs don't shrink, each keeps its width and the row overflows instead", () => {
    const fit = tabWidths(
      [tab(140), tab(140)],
      { min: 0, max: 180, shrink: false },
      200,
    );
    expect(fit.widths).toEqual([180, 180]);
    expect(fit.cut).toEqual([false, false]);
    expect(fit.overflow).toBe(true);
  });

  it("fits no tabs in any row", () => {
    expect(tabWidths([], LIMITS, 0)).toEqual({
      widths: [],
      cut: [],
      overflow: false,
    });
  });
});
