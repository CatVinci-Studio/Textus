import { describe, expect, it } from "vitest";
import { readTyped, stepFrom } from "./step-input";

const size = { min: 10, max: 48, step: 1 };
const leading = { min: 1, max: 3, step: 0.05 };

describe("a number stepper's keys and typing", () => {
  it("steps onto the grid from a value between two steps", () => {
    expect(stepFrom(16.5, 1, size)).toBe(17);
    expect(stepFrom(16.5, -1, size)).toBe(16);
    expect(stepFrom(17, 1, size)).toBe(18);
    expect(stepFrom(1.8, 1, leading)).toBe(1.85);
    expect(stepFrom(1.8, -1, leading)).toBe(1.75);
    expect(stepFrom(48, 1, size)).toBe(48);
  });

  it("reads what is typed, a decimal comma included", () => {
    expect(readTyped(" 18 ")).toBe(18);
    expect(readTyped("1,5")).toBe(1.5);
    expect(readTyped("")).toBeNull();
    expect(readTyped("big")).toBeUndefined();
  });
});
