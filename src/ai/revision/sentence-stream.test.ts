import { describe, expect, it } from "vitest";
import {
  alignStream,
  reachedPrefix,
  type StreamLayout,
} from "./sentence-stream";
import { splitSentences } from "./sentence-diff";
import { diffSentences } from "./unit-diff";

const EN =
  "The keeper woke before dawn. He climbed the stairs slowly. The lamp was still warm. The sea was calm.";
const ZH = "灯塔看守人天亮前醒来。他慢慢爬上楼梯。灯还是温的。海面很平静！";

/** Every prefix of `text`, as a stream hands it over a few characters at a
 *  time, laid out in turn - the high-water mark carried along. */
function stream(original: string, text: string, step = 3): StreamLayout[] {
  const a = splitSentences(original);
  const out: StreamLayout[] = [];
  let reached = 0;
  for (let end = step; end < text.length; end += step) {
    const layout = alignStream(a, text.slice(0, end), false, reached);
    reached = layout.reached;
    out.push(layout);
  }
  out.push(alignStream(a, text, true, reached));
  return out;
}

const changes = (l: StreamLayout) =>
  l.pieces.flatMap((p) =>
    p.kind === "change" ? [{ before: p.before, after: p.after }] : [],
  );

describe("alignStream", () => {
  it("shows each rewritten sentence in place as soon as it is complete", () => {
    const text =
      "The keeper woke before dawn. He climbed the stairs with care. The lamp was still warm. The sea lay calm.";
    const a = splitSentences(EN);
    const mid = alignStream(
      a,
      text.slice(0, text.indexOf("The lamp") + 5),
      false,
    );
    expect(mid.reached).toBe(2);
    expect(mid.pieces.map((p) => p.kind)).toEqual(["same", "change"]);
    expect(changes(mid)).toEqual([
      {
        before: "He climbed the stairs slowly. ",
        after: "He climbed the stairs with care. ",
      },
    ]);
    // Nothing not reached yet is struck.
    expect(mid.pieces.at(-1)!.end).toBe(2);
  });

  it("never strikes the whole original while the stream runs", () => {
    const text =
      "He woke early. He climbed slowly up the stairs. The lamp was warm still. The sea was calm.";
    const a = splitSentences(EN);
    for (const l of stream(EN, text).slice(0, -1)) {
      const struck = l.pieces
        .filter((p) => p.kind === "change")
        .reduce((n, p) => n + p.end - p.start, 0);
      expect(
        struck + (l.partial?.rewrites !== null && l.partial ? 1 : 0),
      ).toBeLessThan(a.length);
    }
  });

  it("ends exactly where diffSentences does", () => {
    const text =
      "The keeper woke before dawn. He climbed the stairs with care. The lamp was still warm.";
    const last = stream(EN, text).at(-1)!;
    expect(last.reached).toBe(4);
    const hunks = diffSentences(EN, text).filter((h) => h.kind === "change");
    expect(changes(last)).toEqual(
      hunks.map((h) =>
        h.kind === "change" ? { before: h.before, after: h.after } : null,
      ),
    );
  });

  it("only moves forward: a sentence reached is never handed back", () => {
    const text =
      "The keeper woke before dawn. He climbed slowly. The lamp was still warm. The sea was calm.";
    let reached = 0;
    for (const l of stream(EN, text)) {
      expect(l.reached).toBeGreaterThanOrEqual(reached);
      reached = l.reached;
    }
  });

  it("marks a dropped sentence deleted once the stream passes it", () => {
    const a = splitSentences(EN);
    const text = "The keeper woke before dawn. The lamp was still warm. ";
    const l = alignStream(a, text + "The s", false);
    expect(l.reached).toBe(3);
    expect(changes(l)).toEqual([
      { before: "He climbed the stairs slowly. ", after: "" },
    ]);
    // ...and before the stream gets there, it is still plain.
    const early = alignStream(a, "The keeper woke before dawn. He", false);
    expect(early.reached).toBe(1);
    expect(changes(early)).toEqual([]);
  });

  it("writes an inserted sentence as its own, the original left plain", () => {
    const a = splitSentences(EN);
    const l = alignStream(
      a,
      "The keeper woke before dawn. Gulls wheeled over the black rocks outside. He",
      false,
    );
    expect(changes(l)).toEqual([
      { before: "", after: "Gulls wheeled over the black rocks outside. " },
    ]);
    expect(l.reached).toBe(1);
    // The partial "He" so far repeats the next original: nothing shown.
    expect(l.partial).toBeNull();
  });

  it("places a partial that skips a dropped sentence by the one it rewrites", () => {
    const a = splitSentences(EN);
    const l = alignStream(
      a,
      "The keeper woke before dawn. He climbed the stairs slowly. The sea lay ca",
      false,
    );
    // "The lamp was still warm." is dropped: the partial goes with "The
    // sea was calm.", and the dropped one stays plain until it completes.
    expect(l.partial).toEqual({ text: "The sea lay ca", rewrites: 3, at: 3 });
    expect(l.reached).toBe(2);
  });

  it("shows nothing for a partial too short to place", () => {
    const a = splitSentences(EN);
    expect(
      alignStream(a, "The keeper woke before dawn. Gulls ", false).partial,
    ).toBeNull();
  });

  it("strikes the sentence being rewritten, not the ones after it", () => {
    const a = splitSentences(EN);
    const l = alignStream(
      a,
      "The keeper woke before dawn. He went up the stair",
      false,
    );
    expect(l.partial).toEqual({
      text: "He went up the stair",
      rewrites: 1,
      at: 1,
    });
  });

  it("writes a long partial unlike the next original as an insertion", () => {
    const a = splitSentences(EN);
    const l = alignStream(
      a,
      "The keeper woke before dawn. Quick brown foxes jumped",
      false,
    );
    expect(l.partial).toEqual({
      text: "Quick brown foxes jumped",
      rewrites: null,
      at: 1,
    });
  });

  it("follows a rewrite that changes the alignment, then settles on the final one", () => {
    // Two originals joined into one: first read as a rewrite of the first.
    const a = splitSentences(EN);
    const text =
      "The keeper woke before dawn and climbed the stairs slowly. The lamp was still warm. The sea was calm.";
    const all = stream(EN, text);
    const final = all.at(-1)!;
    expect(changes(final)).toEqual([
      {
        before: "The keeper woke before dawn. He climbed the stairs slowly. ",
        after: "The keeper woke before dawn and climbed the stairs slowly. ",
      },
    ]);
    expect(final.pieces.map((p) => p.kind)).toEqual(["change", "same", "same"]);
    expect(a).toHaveLength(4);
  });

  it("splits CJK sentences at 。！？", () => {
    const text = "灯塔看守人天亮前醒来。他缓缓走上楼梯。灯";
    const l = alignStream(splitSentences(ZH), text, false);
    expect(l.pieces.map((p) => p.kind)).toEqual(["same", "change"]);
    expect(changes(l)).toEqual([
      { before: "他慢慢爬上楼梯。", after: "他缓缓走上楼梯。" },
    ]);
    // "灯" is how the next original starts: kept so far.
    expect(l.partial).toBeNull();
    const last = stream(
      ZH,
      "灯塔看守人天亮前醒来。他缓缓走上楼梯。灯还是温的。海面很平静？",
    ).at(-1)!;
    expect(changes(last)).toEqual([
      { before: "他慢慢爬上楼梯。", after: "他缓缓走上楼梯。" },
      { before: "海面很平静！", after: "海面很平静？" },
    ]);
  });

  it("treats English ! and ? like the full stop", () => {
    const a = splitSentences("Is it late? It is! Go home.");
    const l = alignStream(a, "Is it late? It is not! G", false);
    expect(changes(l)).toEqual([{ before: "It is! ", after: "It is not! " }]);
    expect(l.reached).toBe(2);
  });

  it("stays cheap on a long paragraph rewritten throughout", () => {
    // Every sentence changed: no word-for-word match to anchor on, so the
    // last run of changes is the whole paragraph - the costly case.
    const n = 80;
    const original = Array.from(
      { length: n },
      (_, i) => `Sentence number ${i} says something about the sea. `,
    );
    const rewrite = Array.from(
      { length: n },
      (_, i) => `Sentence ${i} now says a little more about the sea. `,
    );
    let reached = 0;
    const times: number[] = [];
    for (let k = 1; k <= n; k++) {
      const text = rewrite.slice(0, k).join("") + "Sente";
      // The fastest of three: a busy runner's pause isn't the work's cost.
      let fastest = Infinity;
      let l = alignStream(original, text, false, reached);
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        l = alignStream(original, text, false, reached);
        fastest = Math.min(fastest, performance.now() - start);
      }
      times.push(fastest);
      expect(l.reached).toBeGreaterThanOrEqual(reached);
      reached = l.reached;
    }
    expect(reached).toBe(n);
    // Run once per completed sentence; well under a frame.
    times.sort((a, b) => a - b);
    expect(times[Math.floor(n / 2)]).toBeLessThan(16);
  });
});

describe("how far a stream has reached, paragraph by paragraph", () => {
  const original = splitSentences(
    "小满撑开伞。伞面完好。\n\n雨停了，她把伞挂在门后。\n\n夜里，她找到一枚纽扣。",
  );
  it("a translation reaches an original for each paragraph it has finished", () => {
    const after = splitSentences(
      "Xiaoman opened the umbrella. The canopy was intact.\n\nThe rain stopped.\n\n",
    );
    // Two paragraphs written: the two originals' sentences (3 of them).
    expect(reachedPrefix(original, after)).toBe(3);
  });

  it("a polish is placed by what it says, not by its paragraphs", () => {
    const after = splitSentences("小满撑开了伞。伞面完好无损。\n\n");
    expect(reachedPrefix(original, after)).toBe(2);
  });

  it("a paragraph split in two doesn't reach the next original", () => {
    const after = splitSentences("小满撑开伞。\n\n伞面完好。\n\n");
    expect(reachedPrefix(original, after)).toBe(2);
  });

  it("two paragraphs joined into one reach both", () => {
    const after = splitSentences(
      "小满撑开伞，伞面完好。雨停了，她把伞挂在门后。\n\n",
    );
    expect(reachedPrefix(original, after)).toBe(3);
  });
});
