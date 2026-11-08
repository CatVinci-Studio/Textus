import { describe, expect, it } from "vitest";
import { applyUpdate, finish, thoughtOf, type AgentView } from "./agent-view";
import type { SessionUpdate } from "./acp-client";

const run = (updates: SessionUpdate[]) =>
  updates.reduce<AgentView>(applyUpdate, {
    turns: [{ kind: "User", text: "Tidy the intro" }],
    text: "",
  });

describe("an agent's updates as the chat shows them", () => {
  it("keeps prose before a step, the step by its title, and its result", () => {
    const view = run([
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Let me " },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "look." },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "Read intro.md",
        kind: "read",
        status: "pending",
        locations: [{ path: "/w/intro.md" }],
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "in_progress",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
        content: [
          { type: "content", content: { type: "text", text: "12 lines" } },
        ],
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Done." },
      },
    ]);
    expect(finish(view)).toEqual([
      { kind: "User", text: "Tidy the intro" },
      { kind: "Assistant", text: "Let me look." },
      {
        kind: "ToolCall",
        call_id: "t1",
        name: "agent_tool",
        arguments: JSON.stringify({
          title: "Read intro.md",
          kind: "read",
          path: "/w/intro.md",
        }),
      },
      { kind: "ToolResult", call_id: "t1", output: "12 lines" },
      { kind: "Assistant", text: "Done." },
    ]);
  });

  it("answers a failed step once, and leaves thinking and plans out of the turns", () => {
    const thought: SessionUpdate = {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "hmm" },
    };
    expect(thoughtOf(thought)).toBe("hmm");
    const view = run([
      thought,
      {
        sessionUpdate: "plan",
        entries: [{ content: "Read", status: "pending" }],
      },
      { sessionUpdate: "tool_call", toolCallId: "t2", title: "Run tests" },
      { sessionUpdate: "tool_call_update", toolCallId: "t2", status: "failed" },
      { sessionUpdate: "tool_call_update", toolCallId: "t2", status: "failed" },
    ]);
    expect(finish(view).filter((t) => t.kind === "ToolResult")).toEqual([
      { kind: "ToolResult", call_id: "t2", output: "Failed." },
    ]);
    expect(finish(view)).toHaveLength(3);
  });
});
