import { describe, expect, it } from "vitest";
import { StreamReveal } from "./stream-reveal";

const FRAME = 1000 / 60;

/** Ticks frame by frame from `from` to `to`, returning each frame's text. */
function frames(
  reveal: StreamReveal,
  from: number,
  to: number,
): { at: number; text: string }[] {
  const out = [];
  for (let at = from; at <= to; at += FRAME) {
    reveal.tick(at);
    out.push({ at, text: reveal.text });
  }
  return out;
}

const boundaries = (text: string) =>
  new Set(
    [
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        text,
      ),
    ].map((s) => s.index),
  ).add(text.length);

describe("StreamReveal", () => {
  it("spreads a large chunk over several frames instead of showing it at once", () => {
    const reveal = new StreamReveal();
    const chunk = "word ".repeat(120);
    reveal.update(chunk, false, 0);
    const seen = frames(reveal, FRAME, 400).map((f) => f.text.length);
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[0]).toBeLessThan(chunk.length / 4);
    // Grows every frame, never backwards.
    for (let i = 1; i < seen.length; i++)
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(new Set(seen).size).toBeGreaterThan(10);
  });

  it("shows everything received within 1.5 s of its arrival, however much, at an even pace", () => {
    const reveal = new StreamReveal();
    const text = "长".repeat(5000);
    reveal.update(text, false, 0);
    const seen = frames(reveal, FRAME, 1490).map((f) => f.text.length);
    // Spread over the whole time, not done in its first part.
    expect(seen[Math.floor(1000 / FRAME)]).toBeLessThan(text.length * 0.8);
    // No frame shows more than a few times its share of the whole.
    const share = text.length / (1500 / FRAME);
    for (let i = 1; i < seen.length; i++)
      expect(seen[i] - seen[i - 1]).toBeLessThan(share * 3);
    reveal.tick(1501);
    expect(reveal.text).toBe(text);
  });

  it("types a paragraph that arrives whole over about a second", () => {
    // MiniMax: a tool call's arguments in one piece.
    const reveal = new StreamReveal();
    const text = "雨".repeat(800);
    reveal.update(text, false, 0);
    frames(reveal, FRAME, 300);
    expect(reveal.text.length).toBeLessThan(text.length / 2);
    frames(reveal, 300 + FRAME, 1000);
    expect(reveal.text.length).toBeGreaterThan(text.length * 0.8);
    frames(reveal, 1000 + FRAME, 1500);
    expect(reveal.caughtUp).toBe(true);
  });

  it("follows a bursty stream steadily, about 350 ms behind", () => {
    const reveal = new StreamReveal();
    let received = "";
    const arrivedAt: number[] = [];
    let growthFrames = 0;
    let last = 0;
    for (let at = 0; at < 3000; at += FRAME) {
      // 40 characters every 150 ms, nothing in between.
      if (Math.floor(at / 150) !== Math.floor((at - FRAME) / 150)) {
        for (let i = 0; i < 40; i++) arrivedAt.push(at);
        received += "a".repeat(40);
        reveal.update(received, false, at);
      }
      reveal.tick(at);
      const shown = reveal.text.length;
      expect(received.startsWith(reveal.text)).toBe(true);
      // Every character that arrived 350 ms ago or earlier is on screen.
      const due = arrivedAt.filter((t) => t <= at - 350).length;
      expect(shown).toBeGreaterThanOrEqual(due);
      if (shown > last) growthFrames++;
      // No frame jumps by more than a fraction of a burst.
      expect(shown - last).toBeLessThan(20);
      last = shown;
    }
    // Text moved on most frames, not once per burst.
    expect(growthFrames).toBeGreaterThan((3000 / FRAME) * 0.8);
  });

  it("starts a new pace after a pause instead of pouring out the next chunk", () => {
    const reveal = new StreamReveal();
    reveal.update("hello", true, 0);
    frames(reveal, FRAME, 400);
    expect(reveal.text).toBe("hello");
    reveal.update(`hello${" more".repeat(100)}`, false, 5000);
    reveal.tick(5000 + FRAME);
    expect(reveal.text.length).toBeLessThan(5 + 60);
  });

  it("only ever cuts between graphemes: emoji, flags, skin tones, CJK", () => {
    const text = "家👨‍👩‍👧‍👦人🇨🇳旗👍🏽好é字🙂".repeat(20);
    const ends = boundaries(text);
    const reveal = new StreamReveal();
    // Arriving a few code units at a time, splitting surrogate pairs and
    // joiner sequences across updates.
    for (let end = 3, at = 0; end <= text.length + 3; end += 3, at += FRAME) {
      const received = text.slice(0, end);
      reveal.update(received, end >= text.length, at);
      reveal.tick(at);
      const shown = reveal.text.length;
      // Only the very end of what has arrived may be a cut the rest of the
      // text will still complete - and only once it is overdue.
      if (shown < received.length) expect(ends.has(shown)).toBe(true);
    }
    frames(reveal, 10_000, 10_400);
    expect(reveal.text).toBe(text);
  });

  it("holds the last grapheme back while more may follow, then shows it", () => {
    const reveal = new StreamReveal();
    // The family emoji's joiner and next person may still be coming.
    reveal.update("Hi 👨", false, 0);
    frames(reveal, FRAME, 300);
    expect(reveal.text).toBe("Hi ");
    reveal.update("Hi 👨‍👩‍👧", true, 300);
    frames(reveal, 300 + FRAME, 400);
    expect(reveal.text).toBe("Hi 👨‍👩‍👧");
  });

  it("starts over when the text is replaced by a shorter one", () => {
    const reveal = new StreamReveal();
    reveal.update("Interim prose before a tool call.", false, 0);
    frames(reveal, FRAME, 400);
    reveal.update("", false, 400);
    expect(reveal.text).toBe("");
    reveal.update("The answer.", true, 500);
    frames(reveal, 500 + FRAME, 900);
    expect(reveal.text).toBe("The answer.");
  });
});
