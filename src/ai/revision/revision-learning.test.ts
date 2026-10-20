import { describe, expect, it } from "vitest";
import en from "../../i18n/locales/en";
import zh from "../../i18n/locales/zh";
import {
  COOLDOWN_MS,
  MAX_CHOICES,
  answer,
  choicesFor,
  describeKind,
  emptyLog,
  parseLog,
  record,
  suggestion,
  type ChoiceLog,
} from "./revision-learning";

const QUOTES = "swap\t「」\t“”";
const DAY = COOLDOWN_MS;

/** A log of `kind` decisions: [taken, proposal] each, a minute apart. */
function logOf(decisions: [boolean, string][], kind = QUOTES): ChoiceLog {
  return record(
    emptyLog(),
    decisions.map(([taken, proposal], i) => ({
      kind,
      taken,
      proposal,
      at: i * 60_000,
    })),
  );
}
const NOW = 10 * DAY;

describe("suggestion", () => {
  it("offers a kind rejected three times across two proposals", () => {
    const log = logOf([
      [false, "a"],
      [false, "a"],
      [false, "b"],
    ]);
    expect(suggestion(log, NOW)).toBe(QUOTES);
  });

  it("waits for a third rejection, and for a second proposal", () => {
    expect(
      suggestion(
        logOf([
          [false, "a"],
          [false, "b"],
        ]),
        NOW,
      ),
    ).toBeNull();
    expect(
      suggestion(
        logOf([
          [false, "a"],
          [false, "a"],
          [false, "a"],
        ]),
        NOW,
      ),
    ).toBeNull();
  });

  it("counts only the rejections since the kind was last accepted", () => {
    const log = logOf([
      [false, "a"],
      [false, "a"],
      [true, "b"],
      [false, "c"],
      [false, "d"],
    ]);
    expect(suggestion(log, NOW)).toBeNull();
    expect(
      suggestion(
        record(log, [{ kind: QUOTES, taken: false, proposal: "e", at: 1 }]),
        NOW,
      ),
    ).toBe(QUOTES);
  });

  it("never asks again after Remember or Never, and after Not now only on new evidence", () => {
    const log = logOf([
      [false, "a"],
      [false, "b"],
      [false, "c"],
    ]);
    expect(suggestion(answer(log, QUOTES, "never", 1), NOW)).toBeNull();
    expect(suggestion(answer(log, QUOTES, "remembered", 1), NOW)).toBeNull();
    const later = answer(log, QUOTES, "later", 3 * 60_000);
    expect(suggestion(later, NOW)).toBeNull();
    const more = record(
      later,
      ["d", "e", "e"].map((proposal, i) => ({
        kind: QUOTES,
        taken: false,
        proposal,
        at: 4 * 60_000 + i,
      })),
    );
    expect(suggestion(more, NOW)).toBe(QUOTES);
  });

  it("asks at most once a day, one kind at a time - the longest run", () => {
    const split = "sentences\tsplit";
    const log = record(
      logOf([
        [false, "a"],
        [false, "b"],
        [false, "c"],
      ]),
      ["d", "e", "f", "g"].map((proposal) => ({
        kind: split,
        taken: false,
        proposal,
        at: 0,
      })),
    );
    expect(suggestion(log, NOW)).toBe(split);
    const asked = { ...log, lastAsked: NOW - DAY / 2 };
    expect(suggestion(asked, NOW)).toBeNull();
    expect(suggestion(asked, NOW + DAY)).toBe(split);
  });
});

describe("the log", () => {
  it("keeps only the newest decisions", () => {
    let log = emptyLog();
    for (let i = 0; i < MAX_CHOICES + 50; i++)
      log = record(log, [
        { kind: QUOTES, taken: false, proposal: String(i), at: i },
      ]);
    expect(log.choices).toHaveLength(MAX_CHOICES);
    expect(log.choices[0].proposal).toBe("50");
  });

  it("reads anything that isn't a log as an empty one", () => {
    expect(parseLog(null)).toEqual(emptyLog());
    expect(parseLog({ choices: "x" })).toEqual(emptyLog());
    expect(
      parseLog({
        choices: [
          { kind: QUOTES, taken: false, proposal: "a", at: 1 },
          { kind: 3 },
        ],
      }).choices,
    ).toHaveLength(1);
  });

  it("records a decided change once per kind it is, and nothing for an ordinary rewrite", () => {
    expect(
      choicesFor(
        "p1",
        [
          { before: "她说：「好。」", after: "她说：“好。”", taken: false },
          { before: "The keeper woke.", after: "Dawn came.", taken: false },
        ],
        5,
      ),
    ).toEqual([{ kind: QUOTES, taken: false, proposal: "p1", at: 5 }]);
  });
});

describe("describeKind", () => {
  it("says what was turned down and the requirement, quote styles as themselves", () => {
    const kind = { type: "swap", from: "「」", to: "“”" } as const;
    const zhText = describeKind(kind, zh);
    expect(
      zh.learnSuggestion
        .replace("{what}", zhText.what)
        .replace("{rule}", zhText.rule),
    ).toBe("你多次拒绝了把「」改成“”的修改。要记住吗：保留「」，不要改成“”。");
    expect(
      describeKind({ type: "swap", from: "utilize", to: "use" }, en),
    ).toEqual({
      what: "changing “utilize” to “use”",
      rule: "Keep “utilize”; don't change it to “use”.",
    });
  });
});
