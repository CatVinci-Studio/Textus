import { describe, expect, it } from "vitest";
import { streamStep, type StreamingState } from "./stream-step";
import type { StreamEvent } from "../../platform/ipc";
import type { DocumentSnapshot } from "../doc-markdown";

const blocks = [
  { id: "b1", markdown: "The cat sat on the mat.", kind: "paragraph" },
] as unknown as DocumentSnapshot["blocks"];
const start: StreamingState = { turns: [], text: "", thought: null };
const step = (
  prev: StreamingState | null,
  event: StreamEvent,
  args = new Map<string, string>(),
) => streamStep(prev, event, blocks, args, 1000);

describe("streamStep", () => {
  it("adds prose deltas as text only, while writing", () => {
    const s = step({ ...start, text: "Hel" }, {
      type: "delta",
      text: "lo",
    } as StreamEvent)!;
    expect(s.next.text).toBe("Hello");
    expect(s.textOnly).toBe(true);
    expect(s.phase).toBe("writing");
  });

  it("names the tool coming in and keeps the reply for an edit", () => {
    const s = step({ ...start, text: "Here" }, {
      type: "toolStart",
      name: "propose_edit",
      callId: "c1",
    } as StreamEvent)!;
    expect(s.next).toMatchObject({ text: "Here", tool: "propose_edit" });
    expect(s.phase).toBe("proposing");
  });

  it("shows a note once its passage and whole note are in, then drops it as its call lands", () => {
    const args = new Map<string, string>();
    let state = step(
      start,
      { type: "toolStart", name: "add_comment", callId: "n1" } as StreamEvent,
      args,
    )!.next;
    const half = step(
      state,
      {
        type: "toolArgsDelta",
        callId: "n1",
        delta: '{"block":"b1","anchor":"cat","comment":"Wh',
      } as StreamEvent,
      args,
    );
    expect(half).toBeNull();
    state = step(
      state,
      {
        type: "toolArgsDelta",
        callId: "n1",
        delta: 'ich cat?"}',
      } as StreamEvent,
      args,
    )!.next;
    expect(state.comments).toHaveLength(1);
    expect(
      JSON.parse((state.comments![0] as { arguments: string }).arguments),
    ).toEqual({ block: "b1", anchor: "cat", comment: "Which cat?" });
    const landed = step(state, {
      type: "turn",
      turn: {
        kind: "ToolCall",
        call_id: "n1",
        name: "add_comment",
        arguments: "{}",
      },
    } as StreamEvent)!.next;
    expect(landed.comments).toEqual([]);
    expect(landed.turns).toHaveLength(1);
  });

  it("ignores arguments of calls that aren't notes", () => {
    expect(
      step(start, {
        type: "toolArgsDelta",
        callId: "x",
        delta: "{",
      } as StreamEvent),
    ).toBeNull();
  });

  it("clears the prose a retried attempt streamed", () => {
    expect(
      step({ ...start, text: "garbled" }, { type: "retry" } as StreamEvent)!
        .next.text,
    ).toBe("");
  });
});
