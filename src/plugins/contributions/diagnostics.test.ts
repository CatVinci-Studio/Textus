import { afterEach, expect, it } from "vitest";
import type { SentBlock } from "../../editor/markdown/doc-blocks";
import {
  addDiagnosticProvider,
  diagnose,
  removeDiagnosticProviders,
} from "./diagnostics";

afterEach(() => removeDiagnosticProviders(() => true));

const doc: SentBlock[] = [{ id: "a", kind: "paragraph", markdown: "*  item" }];

it("keeps only slips it can show, each with who found it", async () => {
  addDiagnosticProvider("lint\nmd", {
    plugin: "lint",
    name: "Markdown Lint",
    ask: async () =>
      [
        {
          block: "a",
          severity: "warning",
          message: " One space after the marker ",
          fix: { markdown: "* item", label: "Fix" },
        },
        { block: "a", severity: "fatal", message: "?" },
        { block: "a", severity: "info", message: "" },
        { block: "a", severity: "info", message: "x", fix: 3 },
      ] as never,
  });
  expect((await diagnose(doc, doc, "/n/a.md")).answers).toEqual([
    {
      block: "a",
      anchor: undefined,
      severity: "warning",
      message: "One space after the marker",
      fix: { markdown: "* item", label: "Fix" },
      plugin: "lint",
      name: "Markdown Lint",
    },
  ]);
});

it("names a check slower than its time as late, not as finding nothing", async () => {
  addDiagnosticProvider("slow\nx", {
    plugin: "slow",
    name: "Slow",
    ask: () =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve([{ block: "a", severity: "info", message: "late" }]),
          50,
        ),
      ),
  });
  expect(await diagnose(doc, doc, null, 10)).toEqual({
    answers: [],
    late: ["slow"],
  });
});
