/** Translate durable upstream events; the official runtime owns the loop. */
export function sessionTurn(event) {
  const data = event?.data;
  if (event?.type === "assistant/message")
    return { kind: "Assistant", text: text(data?.message?.content) };
  if (event?.type === "tool/call")
    return {
      kind: "ToolCall",
      call_id: requiredCallId(data.callId),
      name: data.name,
      arguments: data.arguments,
    };
  if (event?.type === "tool/result")
    return {
      kind: "ToolResult",
      call_id: requiredCallId(data.message.toolCallId),
      output: text(data.message.content),
    };
  return null;
}
function requiredCallId(value) {
  if (typeof value !== "string" || !value)
    throw new Error("Invalid Harness event: missing tool call identity");
  return value;
}
function text(content) {
  return (content ?? [])
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}
export function streamDelta(event) {
  return event?.type === "text-delta" && typeof event.delta === "string"
    ? event.delta
    : null;
}
export const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "proposals"],
  properties: {
    text: { type: "string" },
    proposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "anchor", "text", "reason"],
        properties: {
          action: {
            type: "string",
            enum: [
              "append",
              "replace",
              "insert_before",
              "insert_after",
              "delete",
            ],
          },
          anchor: { type: "string" },
          text: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
};
export function responseTurns(value, writable) {
  if (
    !value ||
    typeof value.text !== "string" ||
    !Array.isArray(value.proposals)
  )
    throw new Error("Invalid engine response");
  const turns = [];
  if (writable)
    for (const proposal of value.proposals) {
      if (
        !responseSchema.properties.proposals.items.properties.action.enum.includes(
          proposal.action,
        ) ||
        typeof proposal.text !== "string" ||
        typeof proposal.anchor !== "string"
      )
        throw new Error("Invalid document proposal");
      const call_id = crypto.randomUUID();
      turns.push(
        {
          kind: "ToolCall",
          call_id,
          name: "propose_edit",
          arguments: JSON.stringify(proposal),
        },
        {
          kind: "ToolResult",
          call_id,
          output: "Edit proposed for user review; not applied.",
        },
      );
    }
  if (value.text) turns.push({ kind: "Assistant", text: value.text });
  return turns;
}
