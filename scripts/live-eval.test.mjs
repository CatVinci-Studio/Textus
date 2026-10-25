import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { difference, results } from "./live-eval.mjs";

function runDir(rows) {
  const dir = mkdtempSync(join(tmpdir(), "live-eval-"));
  writeFileSync(
    join(dir, "agent.jsonl"),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  return dir;
}

const row = (id, checks) => ({
  case: id,
  checks: checks.map(([name, ok]) => ({ name, ok })),
});

describe("live-eval results and difference", () => {
  it("reads pass or fail per case and leaves out cases that never ran", () => {
    const map = results(
      runDir([
        row("a", [["edit proposed", true]]),
        row("b", [["edit proposed", false]]),
        row("c", [["not run", false]]),
        row("d", [["budget", false]]),
        row("e", [["request", false]]),
      ]),
    );
    expect([...map]).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  it("lists what started and stopped passing among cases run both times", () => {
    const before = new Map([
      ["a", true],
      ["b", false],
      ["c", true],
    ]);
    const after = new Map([
      ["a", false],
      ["b", true],
      ["d", false],
    ]);
    expect(difference(before, after)).toEqual({ broke: ["a"], fixed: ["b"] });
  });
});
