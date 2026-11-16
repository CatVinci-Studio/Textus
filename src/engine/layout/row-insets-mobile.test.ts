import { describe, expect, it, vi } from "vitest";

vi.mock("../../platform/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isMobileApp: true,
}));

const { barGrip } = await import("./row-insets");

describe("a phone's or tablet's tab row", () => {
  it("keeps no bare bar to grab a window by: its tabs take the room", () => {
    expect(barGrip()).toBe(0);
  });
});
