import { describe, expect, it } from "vitest";
import { createEncounter, advanceEncounter } from "./map-encounters";

describe("margin encounters", () => {
  it("places a visitor ahead of the walker, with varied kinds", () => {
    const first = createEncounter(1, 100, 2000, 0);
    expect(first.distance).toBe(232);
    expect(first.kind).toBe("wanderer");
    expect(createEncounter(2, 100, 2000, 0.99).kind).toBe("beast");
  });
  it("walks toward the protagonist in equal steps, then pauses to interact", () => {
    let visitor = createEncounter(1, 100, 2000, 0.5);
    visitor = advanceEncounter(visitor, 122, 2000)!;
    expect(visitor.distance).toBe(254);
    visitor = advanceEncounter(visitor, 144, 2000)!;
    visitor = advanceEncounter(visitor, 166, 2000)!;
    expect(visitor.phase).toBe("greeting");
    for (let i = 0; i < 3; i++) visitor = advanceEncounter(visitor, 166, 2000)!;
    expect(visitor.phase).toBe("greeting");
    expect(advanceEncounter(visitor, 166, 2000)!.phase).toBe("departing");
  });
  it("detects an encounter across the perimeter seam and cleans it up after departure", () => {
    const visitor = { ...createEncounter(1, 0, 2000, 0), distance: 10 };
    let next = advanceEncounter(visitor, 1990, 2000)!;
    expect(next.phase).toBe("greeting");
    for (let i = 0; i < 4; i++) next = advanceEncounter(next, 1990, 2000)!;
    for (let i = 0; i < 5; i++) next = advanceEncounter(next, 1990, 2000)!;
    expect(advanceEncounter(next, 1990, 2000)).toBeNull();
  });
});
