import { describe, expect, it } from "vitest";
import {
  composeSentences,
  diffSentences,
  splitSentences,
  trimBreaks,
} from "./sentence-diff";

describe("splitSentences", () => {
  it("splits CJK and Latin text without losing a character", () => {
    const zh = "第一句。第二句！“第三句？”最后";
    expect(splitSentences(zh)).toEqual([
      "第一句。",
      "第二句！",
      "“第三句？”",
      "最后",
    ]);
    const en = "One. Two is here! Three?";
    expect(splitSentences(en).join("")).toBe(en);
    expect(splitSentences(en)).toHaveLength(3);
  });

  it("keeps a full stop inside a sentence in it", () => {
    // A decimal or a URL used to fail the split, and the rewrite was
    // shown whole.
    expect(splitSentences("Pi is 3.14 or so. See example.com today.")).toEqual([
      "Pi is 3.14 or so. ",
      "See example.com today.",
    ]);
  });

  it("ends a sentence at a hard break, which goes with it", () => {
    expect(splitSentences("One.\\\nTwo.  \nThree.<br>Four")).toEqual([
      "One.\\\n",
      "Two.  \n",
      "Three.<br>",
      "Four",
    ]);
    expect(splitSentences("No stop\\\nNext.")).toEqual([
      "No stop\\\n",
      "Next.",
    ]);
  });
});

describe("trimBreaks", () => {
  it("leaves a sentence without the break it ends with", () => {
    expect(trimBreaks("One.\\\n")).toBe("One.");
    expect(trimBreaks("Three.<br> ")).toBe("Three.");
    expect(trimBreaks("  Two.  \n")).toBe("Two.");
  });
});

describe("diffSentences + composeSentences", () => {
  // Two of four sentences changed: decided sentence by sentence.
  const before =
    "我们花了整整两个月。访谈了四十六位居民。内容涵盖很多方面。报告下周发布。";
  const after =
    "历时两个月。访谈了四十六位居民。内容涉及看法与担忧。报告下周发布。";
  const hunks = diffSentences(before, after);

  it("finds the changed sentences around the unchanged one", () => {
    expect(hunks.filter((h) => h.kind === "change")).toHaveLength(2);
    expect(hunks[1]).toEqual({ kind: "same", text: "访谈了四十六位居民。" });
  });

  it("takes all, none, or some of the changes", () => {
    expect(composeSentences(hunks, [true, true])).toBe(after);
    expect(composeSentences(hunks, [false, false])).toBe(before);
    expect(composeSentences(hunks, [true, false])).toBe(
      "历时两个月。访谈了四十六位居民。内容涵盖很多方面。报告下周发布。",
    );
  });
});

describe("aligning a rewritten run", () => {
  // Sentences kept as they were, so the changes stay the fewer and are
  // decided one by one.
  const TAIL = "其余各回也多有照应。此处不赘。全书由此展开。";
  const KEPT = " Most were retired. Some had children. All lived nearby.";

  it("keeps sentence decisions when a rewrite splits a sentence in two", () => {
    const before =
      "这一句其实是在呼应第一回的前世姻缘，可以说是全书爱情线的一个起点。宝玉初见黛玉便觉似曾相识，作者就某种意义而言是借这句话点明了木石前盟。贾母一句“胡说”，却把这层深意轻轻带过。" +
      TAIL;
    const after =
      "这一句呼应第一回的前世姻缘，是全书爱情线的起点。宝玉初见黛玉，便觉似曾相识。作者借这句话点明木石前盟。贾母一句“胡说”，把这层深意轻轻带过。" +
      TAIL;
    const changes = diffSentences(before, after).filter(
      (h) => h.kind === "change",
    );
    expect(changes).toHaveLength(3);
    expect(changes[1]).toEqual({
      kind: "change",
      before:
        "宝玉初见黛玉便觉似曾相识，作者就某种意义而言是借这句话点明了木石前盟。",
      after: "宝玉初见黛玉，便觉似曾相识。作者借这句话点明木石前盟。",
    });
    // Taking only the middle one composes cleanly.
    expect(
      composeSentences(diffSentences(before, after), [false, true, false]),
    ).toBe(
      "这一句其实是在呼应第一回的前世姻缘，可以说是全书爱情线的一个起点。宝玉初见黛玉，便觉似曾相识。作者借这句话点明木石前盟。贾母一句“胡说”，却把这层深意轻轻带过。" +
        TAIL,
    );
  });

  it("pairs English sentences joined into one", () => {
    const changes = diffSentences(
      "The study ran in three towns. It took two months. We met forty residents." +
        KEPT,
      "The study ran in three towns over two months. We spoke with forty residents." +
        KEPT,
    ).filter((h) => h.kind === "change");
    expect(changes.map((c) => c.kind === "change" && c.before)).toEqual([
      "The study ran in three towns. It took two months. ",
      "We met forty residents. ",
    ]);
  });

  it("leaves a wholesale rewrite as one change", () => {
    expect(
      diffSentences(
        "Apples are red. Pears are green.",
        "Nothing here matches at all.",
      ).length,
    ).toBe(1);
  });
});

describe("a change over several paragraphs", () => {
  it("is one change for each paragraph, when the paragraphs stay as many", () => {
    // Sentences too unalike to pair: one run across both paragraphs.
    const hunks = diffSentences(
      "Rain fell.\n\nWind rose.",
      "The sea was flat and grey.\n\nNothing moved on the quay.",
    );
    expect(hunks).toEqual([
      {
        kind: "change",
        before: "Rain fell.\n\n",
        after: "The sea was flat and grey.\n\n",
      },
      {
        kind: "change",
        before: "Wind rose.",
        after: "Nothing moved on the quay.",
      },
    ]);
  });

  it("is one change for a paragraph that was rewritten", () => {
    const hunks = diffSentences(
      "Rain fell all night. The wind rose before dawn. Boats came in.",
      "A storm broke over the harbour. Every mooring strained. Boats came in.",
    );
    expect(hunks).toEqual([
      {
        kind: "change",
        before:
          "Rain fell all night. The wind rose before dawn. Boats came in.",
        after:
          "A storm broke over the harbour. Every mooring strained. Boats came in.",
      },
    ]);
  });

  it("stays sentence by sentence for a polish that touched every sentence", () => {
    const hunks = diffSentences(
      "Rain fell all night long. The wind rose before the dawn. Boats came in slowly.",
      "Rain fell all night. The wind rose before dawn. Boats came in slowly.",
    );
    expect(hunks.filter((h) => h.kind === "change")).toHaveLength(2);
  });

  it("sets joined paragraphs against the paragraphs they came from, the rest as it was", () => {
    const hunks = diffSentences(
      "A one. A two.\n\nB one. B two.\n\nC one. C two.",
      "A one. A two. B one. B two.\n\nC one. C two.",
    );
    expect(hunks).toEqual([
      {
        kind: "change",
        before: "A one. A two.\n\nB one. B two.\n\n",
        after: "A one. A two. B one. B two.\n\n",
      },
      { kind: "same", text: "C one. " },
      { kind: "same", text: "C two." },
    ]);
  });

  it("stays one change where paragraphs are joined", () => {
    const hunks = diffSentences(
      "Rain fell.\n\nWind rose.",
      "The sea was flat and grey, and nothing moved on the quay.",
    );
    expect(hunks.filter((h) => h.kind === "change")).toHaveLength(1);
  });
});
