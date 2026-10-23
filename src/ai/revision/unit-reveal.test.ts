// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { UnitReveal, landingEnds } from "./unit-reveal";

describe("landingEnds", () => {
  it("lands a sentence once a space follows its stop, not before", () => {
    expect(landingEnds("One. Tw", 0, false, false)).toEqual([5]);
    expect(landingEnds("One.", 0, false, false)).toEqual([]);
    expect(landingEnds("Pi is 3.1", 0, false, false)).toEqual([]);
    // Once nothing more comes for a while, a stop ends it.
    expect(landingEnds("One.", 0, false, true)).toEqual([4]);
  });

  it("lands a sentence ended by a stop that needs no space", () => {
    expect(landingEnds("你好。世", 0, false, false)).toEqual([3]);
    expect(landingEnds("مرحبا؟", 0, false, false)).toEqual([6]);
  });

  it("lands a heading or a list item when its line ends", () => {
    expect(landingEnds("## Title", 0, false, false)).toEqual([]);
    expect(landingEnds("## Title\n", 0, false, false)).toEqual([9]);
    expect(landingEnds("- one\n- tw", 0, false, false)).toEqual([6]);
  });

  // A table is held whole until the next block: e2e (the editor's parser
  // tells a table, and only the app has one).

  it("lands writing with no stops a paragraph at a time, never half of one on a pause", () => {
    const text = "สวัสดีครับ วันนี้อากาศดี";
    expect(landingEnds(text, 0, false, false)).toEqual([]);
    expect(landingEnds(text, 0, false, true)).toEqual([]);
    expect(landingEnds(`${text}\n\nต่อไป`, 0, false, false)).toEqual([
      text.length + 2,
    ]);
  });

  it("lands everything once the text is done", () => {
    expect(landingEnds("One. Tw", 0, true, false)).toEqual([5, 7]);
  });
});

describe("UnitReveal", () => {
  it("shows whole sentences only, one per mark's time", () => {
    const reveal = new UnitReveal();
    reveal.update("One. Two. Thr", false, 0);
    reveal.tick(1000);
    expect(reveal.text).toBe("One. ");
    reveal.tick(1001);
    // jsdom-free node: markTime() is 0 where nothing moves, so the next
    // complete sentence lands at once.
    expect(reveal.text).toBe("One. Two. ");
    expect(reveal.caughtUp).toBe(false);
    reveal.update("One. Two. Three.", true, 1100);
    reveal.tick(1200);
    expect(reveal.text).toBe("One. Two. Three.");
    expect(reveal.caughtUp).toBe(true);
  });
});
