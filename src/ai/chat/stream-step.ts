import type { PendingPermission } from "../agents/agent-exchange";
import type { AgentTurn } from "../types";
import type { StreamEvent } from "../../platform/ipc";
import { thinkingDone, thinkingEvent, type Thought } from "./thought";
import { parsePartialToolArgs } from "./partial-tool-args";
import { resolveBlockTarget } from "../../editor/markdown/doc-blocks";
import type { DocumentSnapshot } from "../../editor/markdown/doc-markdown";

/** What has streamed in so far for the in-flight exchange: landed turns plus
 *  the prose being generated. Display only; the resolved turns enter
 *  `history`. */
export interface StreamingState {
  turns: AgentTurn[];
  text: string;
  /** The exchange's thinking so far, once the model has thought. */
  thought: Thought | null;
  /** A tool whose call is coming in, for the row under the reply in place
   *  of "Thinking…". */
  tool?: string;
  /** add_comment calls whose passage and note have streamed in, before their
   *  ToolCall lands, so the margin shows each as it is written. */
  comments?: AgentTurn[];
  /** A step an external agent asks the user to allow. */
  permission?: PendingPermission | null;
}

interface StreamStep {
  next: StreamingState;
  /** Only text grew: drawn once a frame, not on every event. */
  textOnly?: boolean;
  /** What the AI is now doing, for plugins watching it. */
  phase?: "writing" | "proposing";
}

/**
 * One stream event folded into what the panel shows, or null when it shows
 * nothing new. `commentArgs` holds add_comment arguments streaming in, by
 * call id, across the exchange's events.
 */
export function streamStep(
  prev: StreamingState | null,
  event: StreamEvent,
  blocks: DocumentSnapshot["blocks"],
  commentArgs: Map<string, string>,
  now: number,
): StreamStep | null {
  const turns = prev?.turns ?? [];
  if (event.type === "thinking")
    return {
      next: {
        turns,
        text: prev?.text ?? "",
        thought: thinkingEvent(prev?.thought ?? null, event.text, now),
      },
      textOnly: true,
    };
  // Anything else means the model has stopped thinking for now.
  const thought = thinkingDone(prev?.thought ?? null, now);
  switch (event.type) {
    case "delta":
      return {
        next: { turns, text: (prev?.text ?? "") + event.text, thought },
        textOnly: true,
        phase: "writing",
      };
    // The attempt that streamed this prose came back garbled and is being
    // sent again; the new attempt streams in its place.
    case "retry":
      return { next: { turns, text: "", thought } };
    case "toolStart":
      if (event.name === "generate_image")
        return { next: { turns, text: "", thought, tool: event.name } };
      if (event.name !== "propose_edit" && event.name !== "add_comment") break;
      // The reply stays; the row under it says an edit (or a note) is
      // coming.
      if (event.name === "add_comment") commentArgs.set(event.callId, "");
      return {
        next: {
          turns,
          text: prev?.text ?? "",
          thought,
          tool: event.name,
          comments: prev?.comments,
        },
        phase: "proposing",
      };
    case "toolArgsDelta": {
      if (!commentArgs.has(event.callId)) break;
      const args = (commentArgs.get(event.callId) ?? "") + event.delta;
      commentArgs.set(event.callId, args);
      const call = streamedComment(prev, event.callId, args, blocks);
      return call && prev
        ? {
            next: {
              ...prev,
              thought,
              comments: [...(prev.comments ?? []), call],
            },
          }
        : null;
    }
    case "turn": {
      // Interim prose that streamed before a tool call is dropped, as the
      // backend prefers tool calls over accompanying text.
      const landed = event.turn.kind === "ToolCall" ? event.turn.call_id : null;
      return {
        next: {
          turns: [...turns, event.turn],
          text: "",
          thought,
          comments: prev?.comments?.filter(
            (c) => c.kind !== "ToolCall" || c.call_id !== landed,
          ),
        },
      };
    }
  }
  return prev && thought !== prev.thought
    ? { next: { ...prev, thought } }
    : null;
}

/** A note streaming in, as its call, once: when the passage and the whole
 *  note are in. The passage is the block it names, and the words in it it
 *  quotes. */
function streamedComment(
  prev: StreamingState | null,
  callId: string,
  args: string,
  blocks: DocumentSnapshot["blocks"],
): AgentTurn | null {
  const { anchor, block, comment } = parsePartialToolArgs(args);
  const shown = prev?.comments?.some(
    (c) => c.kind === "ToolCall" && c.call_id === callId,
  );
  if (!prev || shown || !comment?.complete) return null;
  if (block && !block.complete) return null;
  const target = resolveBlockTarget(blocks, {
    block: block?.value,
    anchor: anchor?.complete ? anchor.value : undefined,
  });
  if (!target) return null;
  return {
    kind: "ToolCall",
    call_id: callId,
    name: "add_comment",
    arguments: JSON.stringify({
      block: target.block,
      anchor: target.anchor,
      comment: comment.value,
    }),
  };
}
