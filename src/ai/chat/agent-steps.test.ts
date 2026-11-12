import { describe, expect, it } from "vitest";
import type { AgentTurn } from "../types";
import { agentStepRuns, foldSteps, stepTitle } from "./agent-steps";

const call = (id: string, title: string, kind: string): AgentTurn => ({
  kind: "ToolCall",
  call_id: id,
  name: "agent_tool",
  arguments: JSON.stringify({ title, kind }),
});
const result = (id: string, output: string): AgentTurn => ({
  kind: "ToolResult",
  call_id: id,
  output,
});

describe("an agent's steps", () => {
  it("are one run under the first, each with what it said", () => {
    const runs = agentStepRuns([
      { kind: "User", text: "tidy" },
      call("a", "Read Plan.md", "read"),
      result("a", "# Plan"),
      call("b", "Edit Plan.md", "edit"),
      result("b", "Done."),
      { kind: "Assistant", text: "Done." },
      call("c", "npm test", "execute"),
    ]);
    expect(runs.get("a")?.map((s) => [s.title, s.output, s.done])).toEqual([
      ["Read Plan.md", "# Plan", true],
      // Nothing but how it ended: nothing to open.
      ["Edit Plan.md", null, true],
    ]);
    expect(runs.get("b")).toEqual([]);
    // Prose between steps starts another run; one still running has no end.
    expect(runs.get("c")?.map((s) => s.done)).toEqual([false]);
  });

  it("fold three looks in a row into one line, never an edit or a command", () => {
    const steps = agentStepRuns([
      call("1", "List", "read"),
      call("2", "Read a", "read"),
      call("3", "grep x", "search"),
      call("4", "Edit a", "edit"),
      call("5", "Read b", "read"),
    ]).get("1")!;
    expect(
      foldSteps(steps).map((p) => ("looks" in p ? p.looks.length : p.step.id)),
    ).toEqual([3, "4", "5"]);
  });

  it("show paths inside the folder from it, a command without backticks", () => {
    expect(stepTitle("Read /Users/me/Notes/Plan.md", "/Users/me/Notes")).toBe(
      "Read Plan.md",
    );
    expect(stepTitle("List /Users/me/Notes", "/Users/me/Notes/")).toBe(
      "List Notes",
    );
    expect(stepTitle("`npm run lint`", null)).toBe("npm run lint");
    expect(stepTitle("Read C:\\n\\a.md", "C:\\n")).toBe("Read a.md");
  });
});
