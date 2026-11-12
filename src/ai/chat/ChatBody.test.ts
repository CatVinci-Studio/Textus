import { describe, expect, it } from "vitest";
import { quickReplyExpands } from "./chat-body-types";
import type { AgentTurn } from "../types";

describe("quickReplyExpands", () => {
  const ask: AgentTurn = { kind: "User", text: "what is this?" };

  it("opens an answer-only reply in full", () => {
    expect(
      quickReplyExpands([ask, { kind: "Assistant", text: "It is a doc." }]),
    ).toBe(true);
  });

  it("keeps a reply that proposed edits compact", () => {
    const history = [
      ask,
      {
        kind: "ToolCall",
        call_id: "c1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: "old",
          text: "new",
        }),
      },
      { kind: "Assistant", text: "Done." },
    ] as AgentTurn[];
    expect(quickReplyExpands(history)).toBe(false);
  });

  it("judges only the newest exchange", () => {
    expect(
      quickReplyExpands([
        { kind: "User", text: "first" },
        { kind: "Assistant", text: "answer" },
        { kind: "User", text: "second" },
      ]),
    ).toBe(false);
  });
});
