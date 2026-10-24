import { describe, expect, it } from "vitest";
import {
  effectiveRevisionDisplay,
  marginViewBlocked,
} from "./revision-display";

describe("marginViewBlocked", () => {
  it("blocks only the margin views, and only when there is no margin", () => {
    const noMargin = { phone: false, marginAvailable: false };
    expect(marginViewBlocked("original", noMargin)).toBe(true);
    // Result only keeps the originals in the margin: it waits for one too.
    expect(marginViewBlocked("final", noMargin)).toBe(true);
    expect(marginViewBlocked("inline", noMargin)).toBe(false);
    expect(
      marginViewBlocked("original", { phone: false, marginAvailable: true }),
    ).toBe(false);
  });

  it("blocks nothing on a phone, which lists only the views needing no margin", () => {
    for (const mode of ["original", "final"] as const)
      expect(
        marginViewBlocked(mode, { phone: true, marginAvailable: false }),
      ).toBe(false);
  });
});

describe("effectiveRevisionDisplay", () => {
  it("draws a margin view inline while there is no margin, and keeps the others", () => {
    expect(effectiveRevisionDisplay("original", false)).toBe("inline");
    expect(effectiveRevisionDisplay("original", true)).toBe("original");
    expect(effectiveRevisionDisplay("final", false)).toBe("inline");
    expect(effectiveRevisionDisplay("final", true)).toBe("final");
    expect(effectiveRevisionDisplay("inline", false)).toBe("inline");
  });

  it("keeps Result only on a phone, where it reads as the result alone", () => {
    expect(effectiveRevisionDisplay("final", false, true)).toBe("final");
  });
});
