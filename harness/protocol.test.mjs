import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionTurn, streamDelta } from "./protocol.mjs";

test("projects official durable tool and assistant events without inventing a second loop", () => {
  assert.deepEqual(
    sessionTurn({
      type: "assistant/message",
      data: { message: { content: [{ type: "text", text: "Hello" }] } },
    }),
    { kind: "Assistant", text: "Hello" },
  );
  assert.deepEqual(
    sessionTurn({
      type: "tool/call",
      data: {
        callId: "call-1",
        name: "propose_edit",
        arguments: '{"action":"append","text":"Draft"}',
      },
    }),
    {
      kind: "ToolCall",
      call_id: "call-1",
      name: "propose_edit",
      arguments: '{"action":"append","text":"Draft"}',
    },
  );
  assert.equal(sessionTurn({ type: "unknown", data: {} }), null);
});
test("ignores non-text deltas and only forwards known text chunks", () => {
  assert.equal(streamDelta({ type: "text-delta", delta: "Draft" }), "Draft");
  assert.equal(
    streamDelta({ type: "reasoning-delta", delta: "internal" }),
    null,
  );
});
test("maps the official tool-result toolCallId to the required call_id", () => {
  assert.deepEqual(
    sessionTurn({
      type: "tool/result",
      data: {
        message: {
          toolCallId: "call-1",
          content: [{ type: "text", text: "Edit proposed for review" }],
        },
      },
    }),
    {
      kind: "ToolResult",
      call_id: "call-1",
      output: "Edit proposed for review",
    },
  );
});
