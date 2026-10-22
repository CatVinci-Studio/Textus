import { describe, expect, it } from "vitest";
import type { AgentTurn } from "../types";
import { insertTurns, memoryTurns, passExchange } from "./memory-pass";

describe("memory pass", () => {
  it("reads the user's messages as typed, and the reply to the last", () => {
    const history: AgentTurn[] = [
      { kind: "User", text: "接着往下写。" },
      { kind: "Assistant", text: "写好了。" },
      {
        kind: "User",
        text: "<selected-text>\n雨停了。\n</selected-text>\n\n破折号太多了。",
      },
      {
        kind: "ToolCall",
        call_id: "e1",
        name: "propose_edit",
        arguments: "{}",
      },
      { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
      { kind: "Assistant", text: "改成了句号。" },
    ];
    expect(passExchange(history)).toEqual({
      messages: ["接着往下写。", "破折号太多了。"],
      reply: "改成了句号。",
    });
  });

  it("keeps each change as a remember call and its result", () => {
    const change = {
      remembered: "personal/memory/No-dashes",
      scope: "personal" as const,
      created: true,
      text: "不用破折号。",
      previous: null,
    };
    let n = 0;
    const turns = memoryTurns([change], () => String(++n));
    expect(turns).toEqual([
      {
        kind: "ToolCall",
        call_id: "memory-1",
        name: "remember",
        arguments: JSON.stringify({ text: "不用破折号。" }),
      },
      {
        kind: "ToolResult",
        call_id: "memory-1",
        output: JSON.stringify(change),
      },
    ]);
  });

  it("goes right after its exchange, though another has started", () => {
    const a: AgentTurn = { kind: "User", text: "a" };
    const b: AgentTurn = { kind: "Assistant", text: "b" };
    const c: AgentTurn = { kind: "User", text: "c" };
    const m: AgentTurn = { kind: "Assistant", text: "m" };
    expect(insertTurns([a, b, c], 2, [m])).toEqual([a, b, m, c]);
    expect(insertTurns([a], 5, [m])).toEqual([a, m]);
  });
});
