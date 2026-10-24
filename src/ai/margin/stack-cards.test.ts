import { describe, expect, it } from "vitest";
import {
  CHIP_HEIGHT,
  CROWDED_DRIFT,
  GROUP_DRIFT,
  STACK_GAP,
  stackCards,
  type Placed,
} from "./margin-layout";
import type { ReviewNote } from "./review-notes-plugin";

/** A note card wanting to stand at `top`. */
function card(key: string, top: number): Placed {
  return {
    item: { kind: "note", key, note: { id: key } as ReviewNote },
    top,
    drift: 0,
    cut: null,
    chip: false,
    group: null,
    ax: 0,
    ay: 0,
  };
}

const tall = () => 120;
const shape = (placed: Placed[]) =>
  placed.map((p) => [p.item.key, p.top, p.cut, p.chip]);

describe("stackCards", () => {
  it("keeps cards that fit whole, level with their passages", () => {
    const placed = [card("b", 300), card("a", 0)];
    stackCards(placed, tall);
    expect(shape(placed)).toEqual([
      ["a", 0, null, false],
      ["b", 300, null, false],
    ]);
  });

  it("lets a card be pushed a little and stay whole", () => {
    const placed = [card("a", 0), card("b", 120 + STACK_GAP - CROWDED_DRIFT)];
    stackCards(placed, tall);
    expect(placed.map((p) => [p.drift, p.cut])).toEqual([
      [0, null],
      [CROWDED_DRIFT, null],
    ]);
  });

  it("cuts notes on adjacent lines to chips, each level with its line", () => {
    // Five notes 50px apart: whole, the last would stand 300px below its
    // line. The last of the run has nothing under it and stays whole.
    const placed = [0, 50, 100, 150, 200].map((top, i) => card(`n${i}`, top));
    stackCards(placed, tall);
    expect(shape(placed)).toEqual([
      ["n0", 0, CHIP_HEIGHT, true],
      ["n1", 50, CHIP_HEIGHT, true],
      ["n2", 100, CHIP_HEIGHT, true],
      ["n3", 150, CHIP_HEIGHT, true],
      ["n4", 200, null, false],
    ]);
  });

  it("cuts a paragraph's rewrite to its paragraph's height", () => {
    // A translation: a card per paragraph, each card twice its paragraph.
    const placed = [0, 150, 300].map((top, i) => card(`p${i}`, top));
    stackCards(placed, () => 300);
    expect(shape(placed)).toEqual([
      ["p0", 0, 150 - STACK_GAP, false],
      ["p1", 150, 150 - STACK_GAP, false],
      ["p2", 300, null, false],
    ]);
  });

  it("leaves the next paragraph's cards alone", () => {
    const placed = [
      ...[0, 50, 100].map((top, i) => card(`n${i}`, top)),
      card("far", 900),
    ];
    stackCards(placed, tall);
    expect(placed.map((p) => p.cut)).toEqual([
      CHIP_HEIGHT,
      CHIP_HEIGHT,
      null,
      null,
    ]);
    expect(placed[3].top).toBe(900);
  });

  it("makes more notes than lines one chip, a group", () => {
    // Eight notes on three lines: even as chips the last would stand far
    // below its line.
    const placed = [0, 0, 0, 30, 30, 30, 60, 60].map((top, i) =>
      card(`n${i}`, top),
    );
    stackCards(placed, tall);
    expect(new Set(placed.map((p) => p.group))).toEqual(new Set(["n0"]));
    expect(new Set(placed.map((p) => p.top))).toEqual(new Set([0]));
    expect(Math.max(...placed.map((p) => p.drift))).toBeLessThan(GROUP_DRIFT);
  });

  it("groups a crowded run a paragraph at a time, each at its paragraph", () => {
    // Forty words glossed over three paragraphs, the third with one: as
    // one run, they were one chip beside the first paragraph.
    const placed = [
      ...Array.from({ length: 20 }, (_, i) => ({ top: i * 4, block: 0 })),
      ...Array.from({ length: 19 }, (_, i) => ({ top: 100 + i * 4, block: 1 })),
      { top: 200, block: 2 },
    ].map(({ top, block }, i) => ({ ...card(`n${i}`, top), block }));
    stackCards(placed, tall);
    const groups = [...new Set(placed.map((p) => p.group))];
    expect(groups).toEqual(["n0", "n20", null]);
    // Each paragraph's chip at its paragraph, the one below it pushed no
    // further than a chip.
    expect(placed[0].top).toBe(0);
    expect(placed[20].top).toBe(100);
    expect(placed[39].top).toBe(200);
    expect(placed[39].chip).toBe(true);
  });
});
