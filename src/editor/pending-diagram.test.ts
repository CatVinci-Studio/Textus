// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { splitMermaidFences } from "./pending-diagram";

describe("splitMermaidFences", () => {
  it("leaves text without a mermaid fence alone", () => {
    expect(splitMermaidFences("Plain text.\n\n```js\nconst a = 1;\n```")).toBe(
      null,
    );
  });

  it("cuts a closed fence out of the text around it, without the line breaks", () => {
    expect(
      splitMermaidFences(
        "Here:\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nDone.",
      ),
    ).toEqual([
      { kind: "text", text: "Here:" },
      {
        kind: "diagram",
        code: "flowchart LR\n  A --> B",
        raw: "```mermaid\nflowchart LR\n  A --> B\n```",
      },
      { kind: "text", text: "Done." },
    ]);
  });

  it("draws an open fence only up to its last complete line", () => {
    expect(
      splitMermaidFences("```mermaid\nflowchart LR\n  A --> B[Fin"),
    ).toEqual([
      {
        kind: "diagram",
        code: "flowchart LR",
        raw: "```mermaid\nflowchart LR\n  A --> B[Fin",
      },
    ]);
  });

  it("has nothing to draw while only the opening line has arrived", () => {
    expect(splitMermaidFences("```mermaid")).toEqual([
      { kind: "diagram", code: "", raw: "```mermaid" },
    ]);
  });

  it("finds every fence in the text", () => {
    const parts = splitMermaidFences(
      "```mermaid\nA\n```\nbetween\n```mermaid\nB\n```",
    );
    expect(parts?.map((p) => (p.kind === "text" ? p.text : p.code))).toEqual([
      "A",
      "between",
      "B",
    ]);
  });
});
