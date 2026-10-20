import { describe, expect, it } from "vitest";
import { thinkingDone, thinkingEvent, thoughtSeconds } from "./thought";

describe("thought", () => {
  it("adds up the phases an exchange thinks in", () => {
    let t = thinkingEvent(null, "", 1_000);
    t = thinkingEvent(t, "Read the ", 1_500);
    t = thinkingEvent(t, "section.", 2_000);
    t = thinkingDone(t, 4_000)!;
    expect(t).toEqual({ text: "Read the section.", ms: 3_000, since: null });
    // A tool step later, it thinks again.
    t = thinkingEvent(t, "", 10_000);
    expect(thoughtSeconds(t, 12_000)).toBe(5);
    expect(thoughtSeconds(thinkingDone(t, 14_000)!, 99_000)).toBe(7);
  });

  it("never reads zero seconds", () => {
    expect(thoughtSeconds(thinkingEvent(null, "", 0), 100)).toBe(1);
  });

  it("leaves an exchange that never thought alone", () => {
    expect(thinkingDone(null, 5)).toBeNull();
  });
});
