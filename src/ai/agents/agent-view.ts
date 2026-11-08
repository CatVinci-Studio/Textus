import type { AgentTurn } from "../types";
import type { ContentBlock, SessionUpdate, ToolCallFields } from "./acp-client";

/**
 * An agent's session updates as the chat shows an exchange: its prose, its
 * thinking, and each step it takes as a tool call (`agent_tool`, named by
 * the agent's own title) answered once it finishes.
 */

export interface AgentView {
  /** Landed turns: the user's, prose before a step, the steps. */
  turns: AgentTurn[];
  /** Prose still coming in. */
  text: string;
}

/** The name an external agent's steps go under in the history. */
export const AGENT_TOOL = "agent_tool";

function textOf(block: ContentBlock | undefined): string {
  return block?.type === "text" && typeof block.text === "string"
    ? block.text
    : "";
}

/** A step's line: its title and kind, as the history keeps arguments. */
function args(fields: ToolCallFields, before?: string): string {
  let prev: Record<string, unknown> = {};
  try {
    prev = before ? JSON.parse(before) : {};
  } catch {
    // An unreadable earlier line: start over.
  }
  const path = fields.locations?.[0]?.path;
  return JSON.stringify({
    ...prev,
    ...(fields.title ? { title: fields.title } : {}),
    ...(fields.kind ? { kind: fields.kind } : {}),
    ...(path ? { path } : {}),
  });
}

/** What a finished step says: its text content, else how it ended. */
function output(fields: ToolCallFields): string {
  const text = (fields.content ?? [])
    .map((c) => (c.type === "content" ? textOf(c.content) : ""))
    .filter(Boolean)
    .join("\n");
  return text || (fields.status === "failed" ? "Failed." : "Done.");
}

/** Prose so far, landed as a turn before a step. */
function landText(view: AgentView): AgentView {
  if (!view.text.trim()) return { ...view, text: "" };
  return {
    turns: [...view.turns, { kind: "Assistant", text: view.text }],
    text: "",
  };
}

/** `view` after `update`; thinking is the caller's (`thoughtOf`). */
export function applyUpdate(view: AgentView, update: SessionUpdate): AgentView {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return {
        ...view,
        text: view.text + textOf(update.content as ContentBlock),
      };
    case "tool_call": {
      const fields = update as ToolCallFields;
      const landed = landText(view);
      return {
        ...landed,
        turns: [
          ...landed.turns,
          {
            kind: "ToolCall",
            call_id: fields.toolCallId,
            name: AGENT_TOOL,
            arguments: args(fields),
          },
          ...(fields.status === "completed" || fields.status === "failed"
            ? [result(fields)]
            : []),
        ],
      };
    }
    case "tool_call_update": {
      const fields = update as ToolCallFields;
      const turns = view.turns.map((t) =>
        t.kind === "ToolCall" && t.call_id === fields.toolCallId
          ? { ...t, arguments: args(fields, t.arguments) }
          : t,
      );
      const done = fields.status === "completed" || fields.status === "failed";
      const answered = turns.some(
        (t) => t.kind === "ToolResult" && t.call_id === fields.toolCallId,
      );
      return {
        ...view,
        turns: done && !answered ? [...turns, result(fields)] : turns,
      };
    }
    default:
      return view;
  }
}

function result(fields: ToolCallFields): AgentTurn {
  return {
    kind: "ToolResult",
    call_id: fields.toolCallId,
    output: output(fields),
  };
}

/** The thinking an update adds, or null for none. */
export function thoughtOf(update: SessionUpdate): string | null {
  return update.sessionUpdate === "agent_thought_chunk"
    ? textOf(update.content as ContentBlock)
    : null;
}

/** `turns` without an external agent's steps, which a model was never
 *  given as its own tools' and can refuse in its history. */
export function withoutAgentSteps(turns: AgentTurn[]): AgentTurn[] {
  const steps = new Set(
    turns.flatMap((t) =>
      t.kind === "ToolCall" && t.name === AGENT_TOOL ? [t.call_id] : [],
    ),
  );
  return turns.filter(
    (t) =>
      !(
        (t.kind === "ToolCall" || t.kind === "ToolResult") &&
        steps.has(t.call_id)
      ),
  );
}

/** The exchange as it ends: its prose landed. */
export function finish(view: AgentView): AgentTurn[] {
  return landText(view).turns;
}
