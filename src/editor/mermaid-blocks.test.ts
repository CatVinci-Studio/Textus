// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { keepReadable } from "./mermaid-blocks";

/** A drawing's box with an SVG of mermaid's shape: sized by its viewBox,
 *  capped by an inline max-width, as mermaid and pele draw them. */
function drawnBox(viewBox: string) {
  const box = document.createElement("div");
  box.innerHTML = `<svg width="100%" style="max-width: 1049.73px" viewBox="${viewBox}"></svg>`;
  return box;
}

describe("keepReadable", () => {
  it("holds a timeline's scale", () => {
    const box = drawnBox("0 0 995 534");
    keepReadable(box, "timeline\n    title History");
    expect(box.querySelector("svg")!.style.minWidth).toBe("647px");
  });

  it("holds a gantt's scale past %% comments", () => {
    const box = drawnBox("0 0 1264 196");
    keepReadable(box, "%% a comment\n\ngantt\ndateFormat YYYY-MM-DD");
    expect(box.querySelector("svg")!.style.minWidth).toBe("822px");
  });

  it("holds a strip past front matter and a directive over lines", () => {
    const box = drawnBox("0 0 1000 200");
    keepReadable(
      box,
      "---\nconfig:\n  theme: base\n---\n%%{init: {\n  'theme': 'dark'\n}}%%\ngitGraph\n  commit",
    );
    expect(box.querySelector("svg")!.style.minWidth).toBe("650px");
  });

  it("lets an ER diagram fit the column", () => {
    const box = drawnBox("0 0 1049.73 474.5");
    keepReadable(box, "erDiagram\n    CUSTOMER ||--o{ ORDER : places");
    expect(box.querySelector("svg")!.style.minWidth).toBe("");
  });

  it("lets a flowchart fit the column", () => {
    const box = drawnBox("0 0 922 70");
    keepReadable(box, "flowchart LR\n    a --> b");
    expect(box.querySelector("svg")!.style.minWidth).toBe("");
  });

  it("lets a chart fit the column", () => {
    const box = drawnBox("0 0 600 400");
    keepReadable(box, "");
    expect(box.querySelector("svg")!.style.minWidth).toBe("");
  });

  it("leaves a box without a drawing alone", () => {
    const box = document.createElement("div");
    keepReadable(box, "gantt");
  });

  it("leaves a drawing without a viewBox alone", () => {
    const box = document.createElement("div");
    box.innerHTML = "<svg></svg>";
    keepReadable(box, "gantt");
    expect(box.querySelector("svg")!.style.minWidth).toBe("");
  });
});
