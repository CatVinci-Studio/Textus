import { describe, expect, it } from "vitest";
import type { AgentTurn } from "../types";
import { itemOf, readTranscript } from "./chat-transcript";
import { OUT_OF_STEPS } from "./out-of-steps";

const call = (id: string, name: string, args: unknown = {}): AgentTurn => ({
  kind: "ToolCall",
  call_id: id,
  name,
  arguments: JSON.stringify(args),
});
const result = (id: string, output: unknown = "Edit proposed"): AgentTurn => ({
  kind: "ToolResult",
  call_id: id,
  output: typeof output === "string" ? output : JSON.stringify(output),
});
const edit = { action: "append", text: "More." };

/** Each turn's item kind, in order. */
const kinds = (turns: AgentTurn[]) => {
  const t = readTranscript(turns);
  return turns.map((turn) => itemOf(turn, t).kind);
};

describe("a conversation read for the panel", () => {
  it("shows proposals in a row as one card under the first", () => {
    const turns = [
      { kind: "User", text: "Go on." } as AgentTurn,
      call("a", "propose_edit", edit),
      result("a"),
      call("b", "propose_edit", edit),
      result("b"),
      { kind: "Assistant", text: "Done." } as AgentTurn,
    ];
    expect(kinds(turns)).toEqual([
      "turn",
      "proposals",
      "none",
      "none",
      "none",
      "turn",
    ]);
  });

  it("shows a proposal it can't read as the call it is", () => {
    expect(kinds([call("a", "propose_edit", { action: "nonsense" })])).toEqual([
      "call",
    ]);
  });

  it("shows a memory by its result, and the step limit as itself", () => {
    const saved = {
      remembered: "personal/memory/No-dashes",
      scope: "personal",
      created: true,
      text: "No dashes.",
    };
    const turns = [
      call("m", "remember", { text: "No dashes." }),
      result("m", saved),
      { kind: "Assistant", text: OUT_OF_STEPS } as AgentTurn,
    ];
    expect(kinds(turns)).toEqual(["none", "memories", "stopped"]);
  });

  it("keeps a single proposal's selection as its request went out", () => {
    const turns = [
      {
        kind: "User",
        text: "<selected-text>\nThe rain.\n</selected-text>\n\nShorter.",
      } as AgentTurn,
      call("a", "propose_edit", edit),
    ];
    const item = itemOf(turns[1], readTranscript(turns));
    expect(item).toMatchObject({
      kind: "proposal",
      callId: "a",
      parsed: { sentSelection: "The rain." },
    });
  });

  it("says why a picture wasn't made, where the user has something to do", () => {
    const turns = [
      call("p", "generate_image", { prompt: "A cat" }),
      result("p", "Not generated: no image model."),
    ];
    expect(kinds(turns)).toEqual(["none", "notMade"]);
  });
});
