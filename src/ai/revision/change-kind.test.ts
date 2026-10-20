import { describe, expect, it } from "vitest";
import { classifyChange, kindKey, parseKindKey } from "./change-kind";

describe("classifyChange", () => {
  it("names a quote style traded for another", () => {
    expect(classifyChange("她说：「明天见。」", "她说：“明天见。”")).toEqual([
      { type: "swap", from: "「」", to: "“”" },
    ]);
    expect(classifyChange('He said "no".', "He said “no”.")).toEqual([
      { type: "swap", from: '""', to: "“”" },
    ]);
  });

  it("names full-width punctuation made half-width, and back", () => {
    expect(classifyChange("周一，周二。", "周一,周二.")).toEqual([
      { type: "width", to: "half" },
    ]);
    expect(classifyChange("周一,周二", "周一，周二")).toEqual([
      { type: "width", to: "full" },
    ]);
  });

  it("names one mark traded for another", () => {
    expect(
      classifyChange("It rained; we stayed in.", "It rained. we stayed in."),
    ).toEqual([{ type: "swap", from: ";", to: "." }]);
  });

  it("names the Oxford comma added or removed, only in a list", () => {
    expect(
      classifyChange("Tea, milk and bread.", "Tea, milk, and bread."),
    ).toEqual([{ type: "oxford", add: true }]);
    expect(
      classifyChange("Tea, milk, or bread.", "Tea, milk or bread."),
    ).toEqual([{ type: "oxford", add: false }]);
    // Two clauses, not a list: no Oxford comma about it.
    expect(classifyChange("I came and I saw.", "I came, and I saw.")).toEqual(
      [],
    );
  });

  it("names contractions spelled out or added", () => {
    expect(
      classifyChange(
        "I don't think it's ready.",
        "I do not think it is ready.",
      ),
    ).toEqual([{ type: "contractions", expand: true }]);
    expect(classifyChange("We are late.", "We’re late.")).toEqual([
      { type: "contractions", expand: false },
    ]);
  });

  it("names one word swapped for another, whole words", () => {
    expect(
      classifyChange("We utilize the old method.", "We use the old method."),
    ).toEqual([{ type: "swap", from: "utilize", to: "use" }]);
    expect(
      classifyChange("我非常喜欢这个方案。", "我很喜欢这个方案。"),
    ).toEqual([{ type: "swap", from: "非常", to: "很" }]);
  });

  it("names sentences split or joined, and a passage cut or lengthened", () => {
    expect(
      classifyChange(
        "The meeting ran long because nobody had read the notes beforehand.",
        "The meeting ran long. Nobody had read the notes beforehand.",
      ),
    ).toEqual([{ type: "sentences", split: true }]);
    expect(
      classifyChange(
        "The meeting ran long. Nobody had read the notes.",
        "The meeting ran long, as nobody had read the notes.",
      ),
    ).toEqual([{ type: "sentences", split: false }]);
    expect(
      classifyChange(
        "We met on Tuesday to talk through the budget for next year in detail.",
        "We met Tuesday about the budget.",
      ),
    ).toEqual([{ type: "length", shorter: true }]);
  });

  it("has no kind for an ordinary rewrite or no change", () => {
    expect(
      classifyChange("The keeper woke early.", "Dawn found the keeper awake."),
    ).toEqual([]);
    expect(classifyChange("Same.", "Same.")).toEqual([]);
    expect(classifyChange("", "New text.")).toEqual([]);
  });
});

describe("kindKey", () => {
  it("round-trips every kind", () => {
    for (const kind of [
      { type: "swap", from: "「」", to: "“”" },
      { type: "width", to: "half" },
      { type: "oxford", add: false },
      { type: "contractions", expand: true },
      { type: "sentences", split: true },
      { type: "length", shorter: false },
    ] as const)
      expect(parseKindKey(kindKey(kind))).toEqual(kind);
    expect(parseKindKey("mood\tgrumpy")).toBeNull();
  });
});
