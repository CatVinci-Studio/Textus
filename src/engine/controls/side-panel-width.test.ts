import { describe, expect, it } from "vitest";
import { DOC_MIN } from "../frame/island-rules";
import {
  PANEL_FLOOR,
  clampSidePanel,
  sidePanelMax,
  sidePanelMin,
} from "./side-panel-width";

const AI = { min: 300, max: 720 };

describe("a side panel in a window too small for it", () => {
  it("keeps the width dragged to where there is room", () => {
    expect(clampSidePanel(600, 2400, AI)).toBe(600);
  });

  it("narrows with the window, never past a share of it", () => {
    // 720 chosen in a wide window, then the window made 1000 wide.
    expect(clampSidePanel(720, 1000, AI)).toBe(450);
  });

  it("leaves the document its room beside the other panel", () => {
    expect(sidePanelMax(1000, AI, 240)).toBe(1000 - 240 - DOC_MIN);
  });

  it("gives way to the document in a small window, and can still be dragged", () => {
    // 860 wide beside a 240 sidebar: 260 left once the document has 360.
    expect(clampSidePanel(380, 860, AI, 240)).toBe(260);
    expect(sidePanelMin(860, AI, 240)).toBeLessThan(260);
    expect(clampSidePanel(100, 860, AI, 240)).toBe(PANEL_FLOOR);
    // With room, its own minimum holds.
    expect(sidePanelMin(1600, AI, 240)).toBe(300);
  });
});
