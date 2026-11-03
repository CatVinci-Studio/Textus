import { describe, expect, it } from "vitest";
import { inRange, storedInRange } from "./step-range";

const size = { min: 10, max: 48, step: 1 };
const leading = { min: 1, max: 3, step: 0.05 };

describe("a numeric setting's range", () => {
  it("keeps a value inside the ends, to the step's places", () => {
    expect(inRange(99, size)).toBe(48);
    expect(inRange(2, size)).toBe(10);
    expect(inRange(16.4, size)).toBe(16);
    expect(inRange(1.533, leading)).toBe(1.53);
  });

  it("reads a stored value back in range, or falls back", () => {
    expect(storedInRange(21, size, "auto")).toBe(21);
    expect(storedInRange("21", size, "auto")).toBe(21);
    expect(storedInRange(100, size, "auto")).toBe(48);
    expect(storedInRange("auto", size, "auto")).toBe("auto");
    expect(storedInRange(null, size, "auto")).toBe("auto");
    expect(storedInRange("", size, "auto")).toBe("auto");
  });
});
