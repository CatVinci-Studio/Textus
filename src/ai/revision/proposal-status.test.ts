import { describe, expect, it } from "vitest";
import {
  annotateProposalStatuses,
  isRefusal,
  refusedProposalIds,
} from "./proposal-status";
import { STOPPED_TOOL_RESULT } from "../chat/cancelled-turns";
import type { AgentTurn } from "../types";

describe("refusedProposalIds", () => {
  const turns: AgentTurn[] = [
    {
      kind: "ToolCall",
      call_id: "ok",
      name: "propose_edit",
      arguments: '{"action":"replace","anchor":"a","text":"b"}',
    },
    { kind: "ToolResult", call_id: "ok", output: "Edit proposed." },
    {
      kind: "ToolCall",
      call_id: "cut",
      name: "propose_edit",
      arguments: '{"action":"replace","anchor":"a","text":"due"}',
    },
    {
      kind: "ToolResult",
      call_id: "cut",
      output: 'Not proposed: `text` is only "due".',
    },
    {
      kind: "ToolCall",
      call_id: "stopped",
      name: "propose_edit",
      arguments: '{"action":"replace","anchor":"a","text":"b"}',
    },
    { kind: "ToolResult", call_id: "stopped", output: STOPPED_TOOL_RESULT },
    {
      kind: "ToolCall",
      call_id: "read",
      name: "read_document",
      arguments: "{}",
    },
    { kind: "ToolResult", call_id: "read", output: "# Title" },
  ];

  it("names only propose_edit calls whose result refused them", () => {
    expect([...refusedProposalIds(turns)]).toEqual(["cut"]);
  });

  it("never stamps a status onto a refusal", () => {
    const out = annotateProposalStatuses(turns, { cut: "rejected" });
    expect(out[3]).toBe(turns[3]);
  });

  // Its streamed preview is dropped and never offered.
  it("treats Write mode's refusal of a replace as a refusal", () => {
    expect(
      isRefusal(
        "Not proposed: Write mode only adds text, with append, insert_at_cursor, insert_after, insert_before - `replace` would change or remove text that is already there.",
      ),
    ).toBe(true);
  });
});

const history: AgentTurn[] = [
  { kind: "User", text: "tighten the intro" },
  {
    kind: "ToolCall",
    call_id: "call-1",
    name: "propose_edit",
    arguments: '{"action":"replace","anchor":"a","text":"b"}',
  },
  { kind: "ToolResult", call_id: "call-1", output: "Edit proposed." },
  { kind: "Assistant", text: "Tightened the intro." },
];

describe("annotateProposalStatuses", () => {
  it("appends the current status to a known proposal's tool result", () => {
    const out = annotateProposalStatuses(history, { "call-1": "pending" });
    const result = out[2];
    if (result.kind !== "ToolResult") throw new Error("turn order changed");
    expect(result.output).toContain("Edit proposed.");
    expect(result.output).toContain("NOT yet accepted or rejected");
  });

  it("distinguishes accepted from rejected", () => {
    const accepted = annotateProposalStatuses(history, {
      "call-1": "accepted",
    });
    const rejected = annotateProposalStatuses(history, {
      "call-1": "rejected",
    });
    expect((accepted[2] as { output: string }).output).toContain("accepted");
    expect((rejected[2] as { output: string }).output).toContain("rejected");
  });

  it("leaves tool results absent from the status map untouched", () => {
    const out = annotateProposalStatuses(history, { "other-call": "pending" });
    expect(out[2]).toBe(history[2]);
  });

  it("returns the history unchanged when there are no statuses", () => {
    expect(annotateProposalStatuses(history, {})).toBe(history);
  });

  it("never rewrites the stored turns themselves", () => {
    const before = (history[2] as { output: string }).output;
    annotateProposalStatuses(history, { "call-1": "invalid" });
    expect((history[2] as { output: string }).output).toBe(before);
  });
});
