import { describe, expect, it } from "vitest";
import type { AgentTurn } from "../types";
import { foldToolSteps, toolStepCounts } from "./tool-steps";

const call = (id: string, name: string, args = "{}"): AgentTurn => ({
  kind: "ToolCall",
  call_id: id,
  name,
  arguments: args,
});
const result = (id: string, output: string): AgentTurn => ({
  kind: "ToolResult",
  call_id: id,
  output,
});

describe("foldToolSteps", () => {
  it("folds a run of steps, results included, into its first call", () => {
    const turns: AgentTurn[] = [
      { kind: "User", text: "write 800 字", images: [] },
      call("1", "measure_text"),
      result("1", "790 chars"),
      call("2", "check_conventions"),
      result("2", "fine"),
      call("3", "measure_text"),
      result("3", "812 chars"),
      { kind: "Assistant", text: "Stopped" },
    ];
    const { groups, folded } = foldToolSteps(turns);
    expect([...groups.keys()]).toEqual([1]);
    expect(groups.get(1)!.map((s) => [s.name, s.output])).toEqual([
      ["measure_text", "790 chars"],
      ["check_conventions", "fine"],
      ["measure_text", "812 chars"],
    ]);
    expect([...folded].sort()).toEqual([2, 3, 4, 5, 6]);
    expect(toolStepCounts(groups.get(1)!)).toEqual([
      { name: "measure_text", count: 2, arguments: "{}" },
      { name: "check_conventions", count: 1, arguments: "{}" },
    ]);
  });

  it("leaves cards alone and starts a new run after one", () => {
    const turns: AgentTurn[] = [
      call("a", "read_document"),
      result("a", "text"),
      call("p", "propose_edit", '{"action":"append","text":"x"}'),
      result("p", "Edit proposed"),
      call("b", "measure_text"),
      result("b", "1 char"),
    ];
    const { groups, folded } = foldToolSteps(turns);
    expect([...groups.keys()]).toEqual([0, 4]);
    // The proposal and its result are not folded away.
    expect(folded.has(2) || folded.has(3)).toBe(false);
  });

  it("keeps a step still running without a result", () => {
    const { groups } = foldToolSteps([call("1", "search_document")]);
    expect(groups.get(0)).toEqual([
      { name: "search_document", arguments: "{}", output: null },
    ]);
  });
});
