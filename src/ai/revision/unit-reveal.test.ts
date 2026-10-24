// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { HOLD_MS, UnitReveal, landingEnds } from "./unit-reveal";

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

describe("new writing, a paragraph at a time", () => {
  it("lands a paragraph only once it is written whole", () => {
    const para = (text: string, done = false) =>
      landingEnds(text, 0, done, false, true);
    // Its sentences wait for the paragraph's end.
    expect(para("One. Two. Thr")).toEqual([]);
    expect(para("One. Two.\n\nThree")).toEqual([11]);
    // The end of the text ends it, as does a heading after it.
    expect(para("One. Two.", true)).toEqual([9]);
    expect(para("One.\n## Next\n\n")).toContain(5);
  });
});

describe("a long paragraph, in batches", () => {
  it("lands the sentences it has finished together once held long enough, then again", () => {
    const reveal = new UnitReveal(true);
    reveal.update("One. Two. Thr", false, 0);
    reveal.tick(10);
    // Held: its end hasn't come.
    reveal.tick(HOLD_MS - 1);
    expect(reveal.text).toBe("");
    // Held long enough: both finished sentences at once, not the half one.
    reveal.tick(HOLD_MS + 10);
    expect(reveal.text).toBe("One. Two. ");
    expect(reveal.endsOnUnit).toBe(true);
    // More finished: they wait for the next batch...
    reveal.update("One. Two. Three. Four. Fi", false, HOLD_MS + 20);
    reveal.tick(HOLD_MS + 30);
    expect(reveal.text).toBe("One. Two. ");
    // ...which comes HOLD_MS after the first.
    reveal.tick(2 * HOLD_MS + 20);
    expect(reveal.text).toBe("One. Two. Three. Four. ");
    // The paragraph's end lands the rest at once.
    reveal.update(
      "One. Two. Three. Four. Five.\n\nNext",
      false,
      2 * HOLD_MS + 30,
    );
    reveal.tick(2 * HOLD_MS + 40);
    expect(reveal.text).toBe("One. Two. Three. Four. Five.\n\n");
  });

  it("holds a short paragraph whole", () => {
    const reveal = new UnitReveal(true);
    reveal.update("One. Two. Thr", false, 0);
    reveal.tick(10);
    reveal.update("One. Two. Three.\n\n", false, 100);
    reveal.tick(200);
    expect(reveal.text).toBe("One. Two. Three.\n\n");
  });
});
