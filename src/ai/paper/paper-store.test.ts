import { describe, expect, it } from "vitest";
import { proposalsFromTurns } from "../chat/chat-body-types";
import {
  applyPaperEvent,
  paperCardTurns,
  paperLanguage,
  paperProposalTurns,
  paperRun,
  parsePaperCard,
  PAPER_TURN,
  RECENT_ACTIVITY,
} from "./paper-store";

describe("the paper store", () => {
  it("puts a card in the conversation that parses back", () => {
    const turns = paperCardTurns(
      "k1",
      "Green roofs",
      "Write a paper: Green roofs",
    );
    expect(turns.map((t) => t.kind)).toEqual([
      "User",
      "ToolCall",
      "ToolResult",
    ]);
    const result = turns[2];
    if (result.kind !== "ToolResult") throw new Error();
    expect(parsePaperCard(result.call_id, result.output)).toEqual({
      key: "k1",
      topic: "Green roofs",
    });
    expect(parsePaperCard("remember-1", result.output)).toBeNull();
    expect(parsePaperCard(`${PAPER_TURN}-x`, "not json")).toBeNull();
  });

  it("follows a run's events", () => {
    applyPaperEvent("k2", { type: "phase", phase: "researching" });
    applyPaperEvent("k2", { type: "section", index: 1, status: "drafted" });
    applyPaperEvent("k2", {
      type: "outlineReady",
      outline: { thesis: "T", sections: [] },
    });
    const run = paperRun("k2")!;
    expect(run.phase).toBe("researching");
    expect(run.sections).toEqual({ 1: "drafted" });
    expect(run.outline?.thesis).toBe("T");
  });

  it("follows the research question by question", () => {
    applyPaperEvent("k4", { type: "thinking", text: "First the background" });
    expect(paperRun("k4")!.thinking).toBe("First the background");
    applyPaperEvent("k4", { type: "questions", questions: ["A?", "B?"] });
    applyPaperEvent("k4", { type: "phase", phase: "researching" });
    expect(paperRun("k4")!.thinking).toBe("");
    applyPaperEvent("k4", {
      type: "activity",
      question: 1,
      kind: "search",
      detail: "green roofs",
    });
    for (let i = 0; i < RECENT_ACTIVITY + 1; i++) {
      applyPaperEvent("k4", {
        type: "activity",
        question: 0,
        kind: "note",
        detail: `claim ${i}`,
      });
    }
    // An event for a question the run doesn't have changes nothing.
    applyPaperEvent("k4", {
      type: "questionDone",
      question: 9,
      notes: 1,
      failed: false,
    });
    applyPaperEvent("k4", {
      type: "questionDone",
      question: 1,
      notes: 0,
      failed: true,
    });
    const run = paperRun("k4")!;
    expect(run.questions).toEqual([
      { text: "A?", state: "active", notes: RECENT_ACTIVITY + 1 },
      { text: "B?", state: "failed", notes: 0 },
    ]);
    expect(run.recent).toHaveLength(RECENT_ACTIVITY);
    expect(run.recent[0].detail).toBe(`claim ${RECENT_ACTIVITY}`);
    expect(new Set(run.recent.map((a) => a.id)).size).toBe(RECENT_ACTIVITY);
  });

  it("keeps the outline and each section as they are written", () => {
    applyPaperEvent("k5", {
      type: "outlineDraft",
      attempt: 2,
      thesis: "Green cools",
      titles: ["Intro"],
    });
    applyPaperEvent("k5", { type: "sectionText", index: 1, text: "So far" });
    applyPaperEvent("k5", {
      type: "sectionText",
      index: 1,
      text: "So far, more",
    });
    const run = paperRun("k5")!;
    expect(run.outlineDraft).toEqual({
      attempt: 2,
      thesis: "Green cools",
      titles: ["Intro"],
    });
    expect(run.sectionText).toEqual({ 1: "So far, more" });
  });

  it("knows when research can't search the web", () => {
    applyPaperEvent("k6", { type: "phase", phase: "planning" });
    expect(paperRun("k6")!.webSearch).toBeNull();
    applyPaperEvent("k6", { type: "webSearch", available: false });
    expect(paperRun("k6")!.webSearch).toBe(false);
  });

  it("proposes the paper as one append", () => {
    const found = proposalsFromTurns(
      paperProposalTurns("k3", "# Title\n\nText.", "Proposed."),
    );
    expect(found).toHaveLength(1);
    expect(found[0].callId).toBe("paper-k3#0");
    expect(found[0].proposal).toMatchObject({
      action: "append",
      text: "# Title\n\nText.",
    });
  });

  it("writes in the topic's script, else the UI's language", () => {
    expect(paperLanguage("城市热岛效应", "en")).toBe("zh");
    expect(paperLanguage("城市热岛效应", "zh-Hant")).toBe("zh-Hant");
    expect(paperLanguage("ヒートアイランド", "en")).toBe("ja");
    expect(paperLanguage("Green roofs", "zh")).toBe("en");
    expect(paperLanguage("Green roofs", "de")).toBe("de");
  });
});
