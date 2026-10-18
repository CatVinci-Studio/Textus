import { describe, expect, it } from "vitest";
import {
  effectiveRevisionDisplay,
  marginViewBlocked,
} from "./revision-display";

describe("marginViewBlocked", () => {
  it("blocks only the margin views, and only when there is no margin", () => {
    const noMargin = { phone: false, marginAvailable: false };
    expect(marginViewBlocked("original", noMargin)).toBe(true);
    expect(marginViewBlocked("new", noMargin)).toBe(true);
    expect(marginViewBlocked("inline", noMargin)).toBe(false);
    expect(marginViewBlocked("final", noMargin)).toBe(false);
    expect(
      marginViewBlocked("original", { phone: false, marginAvailable: true }),
    ).toBe(false);
  });

  it("blocks nothing on a phone, which lists only the views needing no margin", () => {
    expect(
      marginViewBlocked("original", { phone: true, marginAvailable: false }),
    ).toBe(false);
  });
});

describe("effectiveRevisionDisplay", () => {
  it("draws a margin view inline while there is no margin, and keeps the others", () => {
    expect(effectiveRevisionDisplay("new", false)).toBe("inline");
    expect(effectiveRevisionDisplay("new", true)).toBe("new");
    expect(effectiveRevisionDisplay("final", false)).toBe("final");
  });
});
