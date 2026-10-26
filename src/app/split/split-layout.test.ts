import { afterEach, describe, expect, it } from "vitest";
import {
  arrangeSplit,
  closeSplit,
  setSplitLayout,
  splitLayout,
} from "./split-layout";

afterEach(() => closeSplit());

describe("arrangeSplit", () => {
  it("swaps the panes' tabs and sets the first one's share, clamped", () => {
    setSplitLayout({ direction: "row", panes: ["a", "b"], ratio: 0.5 });
    arrangeSplit({ swap: true });
    expect(splitLayout()).toMatchObject({ panes: ["b", "a"], ratio: 0.5 });
    arrangeSplit({ ratio: 0.95 });
    expect(splitLayout()?.ratio).toBe(0.8);
    arrangeSplit({ ratio: 0.3 });
    expect(splitLayout()).toMatchObject({ panes: ["b", "a"], ratio: 0.3 });
  });

  it("does nothing with one document", () => {
    arrangeSplit({ swap: true, ratio: 0.3 });
    expect(splitLayout()).toBeNull();
  });
});
