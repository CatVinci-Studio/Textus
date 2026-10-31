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
