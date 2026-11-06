import { describe, expect, it } from "vitest";
import { resolveStrings } from "../../i18n/strings";
import type { PaperEvent } from "../../platform/bindings/ai-paper";
import { applyPaperEvent, paperRun } from "./paper-store";
import { concurrencyLine, paperConcurrency, previewText } from "./paper-ui";

describe("a section's preview", () => {
  it("shows the text plain, citations as numbers", () => {
    expect(
      previewText(
        "### Heat\n\nRoofs cool **streets** [3](https://a.example/x).\n\n\n\nMore.",
      ),
    ).toBe("Heat\n\nRoofs cool streets [3].\n\nMore.");
  });

  it("numbers citations as the paper does", () => {
    expect(
      previewText("A [93](https://a.example/x).", new Map([[93, 1]])),
    ).toBe("A [1].");
  });
});

let runs = 0;

/** A run after `events`, in a store key of its own. */
function runAfter(events: PaperEvent[]) {
  const key = `concurrency-${++runs}`;
  for (const event of events) applyPaperEvent(key, event);
  return paperRun(key)!;
}

const section = (title: string) => ({
  title,
  keyPoints: [],
  evidence: [],
  targetWords: 100,
  figures: [],
});

const drafting = (count: number): PaperEvent[] => [
  {
    type: "outlineReady",
    outline: {
      thesis: "T",
      sections: Array.from({ length: count }, (_, i) => section(`S${i}`)),
    },
  },
  { type: "phase", phase: "drafting" },
];

const en = resolveStrings("en");

describe("how much of the paper is under way at once", () => {
  it("counts sections finished out of order as done", () => {
    const run = runAfter([
      ...drafting(8),
      { type: "section", index: 0, status: "drafting" },
      { type: "section", index: 3, status: "drafting" },
      { type: "section", index: 5, status: "drafting" },
      { type: "section", index: 3, status: "drafted" },
      { type: "section", index: 6, status: "drafted" },
    ]);
    expect(paperConcurrency(run)).toEqual({
      of: "sections",
      active: 2,
      done: 2,
      total: 8,
    });
  });

  it("says how many sections are written at once", () => {
    const run = runAfter([
      ...drafting(8),
      { type: "section", index: 0, status: "drafting" },
      { type: "section", index: 1, status: "drafting" },
      { type: "section", index: 2, status: "drafting" },
      { type: "section", index: 4, status: "drafted" },
      { type: "section", index: 7, status: "drafted" },
    ]);
    expect(concurrencyLine(paperConcurrency(run)!, run.phase, en, "en")).toBe(
      "Writing 3 sections at once · 2 of 8 done",
    );
  });

  it("only says how many are done when one is under way", () => {
    const run = runAfter([
      ...drafting(4),
      { type: "section", index: 2, status: "drafting" },
      { type: "section", index: 0, status: "drafted" },
    ]);
    expect(concurrencyLine(paperConcurrency(run)!, run.phase, en, "en")).toBe(
      "1 of 4 done",
    );
  });

  it("counts revised sections as under way while reviewing", () => {
    const run = runAfter([
      ...drafting(3),
      { type: "section", index: 0, status: "drafted" },
      { type: "section", index: 1, status: "drafted" },
      { type: "section", index: 2, status: "drafted" },
      { type: "phase", phase: "reviewing" },
      { type: "section", index: 2, status: "revising" },
      { type: "section", index: 0, status: "revising" },
    ]);
    expect(concurrencyLine(paperConcurrency(run)!, run.phase, en, "en")).toBe(
      "Revising 2 sections at once · 1 of 3 done",
    );
  });

  it("counts questions researched at once, failed ones as done", () => {
    const run = runAfter([
      { type: "phase", phase: "researching" },
      { type: "questions", questions: ["a", "b", "c", "d", "e"] },
      { type: "activity", question: 1, tool: "web_search", arguments: "{}" },
      { type: "activity", question: 3, tool: "web_search", arguments: "{}" },
      { type: "questionDone", question: 0, notes: 2, failed: false },
      { type: "questionDone", question: 4, notes: 0, failed: true },
    ]);
    expect(concurrencyLine(paperConcurrency(run)!, run.phase, en, "en")).toBe(
      "Researching 2 questions at once · 2 of 5 done",
    );
  });

  it("says nothing before there is a list, or in other phases", () => {
    expect(
      paperConcurrency(runAfter([{ type: "phase", phase: "researching" }])),
    ).toBeNull();
    expect(
      paperConcurrency(runAfter([{ type: "phase", phase: "outlining" }])),
    ).toBeNull();
  });
});
