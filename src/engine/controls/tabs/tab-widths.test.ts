import { describe, expect, it } from "vitest";
import {
  dragSlots,
  incomingSlots,
  revealAt,
  snapToTab,
  stripSlots,
  tailFor,
} from "./tab-strip";
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

  it("overflowing, no tab is wider than what shows beside the list button", () => {
    // A phone's tabs keep their names' widths and scroll.
    const limits = { ...LIMITS, shrink: false };
    const fit = tabWidths([tab(160), tab(60)], limits, 150, 2, 126);
    expect(fit.overflow).toBe(true);
    expect(fit.widths).toEqual([126, 100]);
    expect(fit.cut).toEqual([true, false]);
    // One that fits once capped needs no list: it takes the row.
    const one = tabWidths([tab(180)], limits, 200, 2, 174);
    expect(one).toMatchObject({ widths: [200], overflow: false });
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

  it("never squeezes a name below a few letters: the row overflows first", () => {
    // 5 tabs in 310: an even share (62) would leave each 22 of its name.
    const limits = { ...LIMITS, fewest: 30 };
    const fit = tabWidths(Array(5).fill(tab(80)), limits, 310);
    expect(fit.widths).toEqual(Array(5).fill(70));
    expect(fit.overflow).toBe(true);
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

  it("squeezed, the open tab keeps its whole name and the others share what is left", () => {
    const tabs = [tab(140), { ...tab(140), open: true }, tab(140)];
    const fit = tabWidths(tabs, LIMITS, 360);
    expect(fit.widths).toEqual([90, 180, 90]);
    expect(fit.cut).toEqual([true, false, true]);
    // Short of room even so, the others keep a few letters and it gives.
    const tight = tabWidths(tabs, { ...LIMITS, fewest: 30 }, 240);
    expect(tight.widths).toEqual([70, 100, 70]);
    expect(tight.overflow).toBe(false);
    // The others overflowing at their least, the row scrolls: it is whole.
    const over = tabWidths(tabs, LIMITS, 150, 0, 126);
    expect(over).toMatchObject({ widths: [56, 126, 56], overflow: true });
  });

  it("a tab whose × is hidden till it opens gives its name the ×'s room", () => {
    // 1 px over its room with the × counted: whole without it.
    const hidden = { ...tab(61), spare: 22 };
    const fit = tabWidths([hidden, tab(61)], { ...LIMITS, max: 100 }, 600);
    expect(fit.cut).toEqual([false, true]);
    // Squeezed, its least is a few letters with that room too: the open
    // tab keeps the rest and shows whole.
    const open = { ...tab(61, 43), open: true };
    const tight = tabWidths(
      [{ ...tab(109, 43), spare: 27 }, open],
      { ...LIMITS, fewest: 36 },
      182,
    );
    expect(tight.widths).toEqual([78, 104]);
    expect(tight.cut).toEqual([true, false]);
  });

  it("a tab whose least is more than the others' share keeps it, and the rest still fit", () => {
    // A padlock's tab can't go as narrow as the others: they give more.
    const tabs = [
      tab(100),
      tab(100),
      tab(100),
      tab(100, FIXED + 14),
      { ...tab(60), open: true },
    ];
    const fit = tabWidths(tabs, { ...LIMITS, fewest: 30 }, 400);
    expect(fit.overflow).toBe(false);
    expect(fit.widths.reduce((a, w) => a + w, 0)).toBeLessThanOrEqual(400);
    expect(fit.widths[3]).toBe(FIXED + 14 + 30);
    expect(fit.cut[4]).toBe(false);
  });

  it("fits no tabs in any row", () => {
    expect(tabWidths([], LIMITS, 0)).toEqual({
      widths: [],
      cut: [],
      overflow: false,
    });
  });
});

describe("the tabs' places along their strip", () => {
  const slots = stripSlots([100, 60, 80], 2);

  it("lays them side by side, a gap apart", () => {
    expect(slots).toEqual([
      { x: 0, w: 100 },
      { x: 102, w: 60 },
      { x: 164, w: 80 },
    ]);
  });

  it("makes room as a dragged tab passes the others", () => {
    const drag = dragSlots(slots, 0, 160, 2);
    expect(drag.to).toBe(2);
    expect(drag.slots.map((s) => s.x)).toEqual([0, 0, 62]);
    expect(dragSlots(slots, 0, 10, 2).to).toBe(0);
  });

  it("opens a place for a tab riding in, kept inside the strip", () => {
    const ride = incomingSlots(slots, 50, 140, 2);
    expect(ride.at).toBe(2);
    expect(ride.slots.map((s) => s.x)).toEqual([0, 102, 216]);
    expect(incomingSlots(slots, 50, -40, 2).incoming.x).toBe(0);
  });
});

describe("bringing the open tab into view", () => {
  const fade = 36;
  it("leaves it clear of the start's fade once scrolled", () => {
    // Shown at 300 of 400 scrolled: back to 300 would put it under the fade.
    expect(revealAt({ x: 300, w: 80 }, 350, 200, fade)).toBe(264);
  });
  it("scrolls home when the fade's room reaches the start", () => {
    expect(revealAt({ x: 20, w: 80 }, 50, 200, fade)).toBe(0);
  });
  it("keeps the whole tab when the row is barely wider than it", () => {
    expect(revealAt({ x: 300, w: 180 }, 350, 200, fade)).toBe(280);
  });
  it("on a touch row, scrolled to a tab's start: no part of the tab before it shows", () => {
    // Tabs start at 0, 90, 180, 270; the open one at 270, 80 wide, in 200.
    const left = revealAt({ x: 270, w: 80 }, 0, 200, 0, 0)!;
    expect(snapToTab(left, [0, 90, 180, 270], 270)).toBe(180);
  });
  it("on a touch row, gives the end room to scroll to the last tabs' starts", () => {
    // Tabs end at 350, 200 shown: scrolled at most to 150 without more.
    expect(tailFor(90, 350, 200)).toBe(0);
    // The open tab at 270 after a close: 120 more room.
    expect(tailFor(270, 350, 200)).toBe(120);
  });
  it("stays put with the tab already clear", () => {
    expect(revealAt({ x: 100, w: 60 }, 40, 300, fade)).toBeNull();
  });
});
