import { describe, expect, it } from "vitest";
import type { Outline } from "../../platform/bindings/ai-paper";
import {
  addSection,
  editFigures,
  editSection,
  keyPointsFrom,
  keyPointsText,
  moveSection,
  removeSection,
  totalLength,
} from "./outline-edit";

const section = (title: string, targetWords = 1000) => ({
  title,
  keyPoints: [],
  evidence: ["n1"],
  targetWords,
  figures: [],
});
const outline: Outline = {
  thesis: "Green roofs cool cities.",
  sections: [section("A"), section("B", 1500), section("C")],
};
const titles = (o: Outline) => o.sections.map((s) => s.title);

describe("editing an outline", () => {
  it("changes, moves, adds and removes sections without touching the original", () => {
    expect(titles(editSection(outline, 1, { title: "B2" }))).toEqual([
      "A",
      "B2",
      "C",
    ]);
    expect(titles(moveSection(outline, 0, 1))).toEqual(["B", "A", "C"]);
    expect(moveSection(outline, 0, -1)).toBe(outline);
    expect(moveSection(outline, 2, 1)).toBe(outline);
    const added = addSection(outline, 1, "New");
    expect(titles(added)).toEqual(["A", "B", "New", "C"]);
    expect(added.sections[2].targetWords).toBe(1500);
    expect(titles(removeSection(outline, 0))).toEqual(["B", "C"]);
    expect(titles(outline)).toEqual(["A", "B", "C"]);
  });

  it("keeps the last section", () => {
    const one: Outline = { thesis: "", sections: [section("Only")] };
    expect(removeSection(one, 0)).toBe(one);
  });

  it("edits a section's figures and adds up the lengths", () => {
    const withFigure = editFigures(outline, 2, (f) => [
      ...f,
      { kind: "chart", spec: "Temperatures" },
    ]);
    expect(withFigure.sections[2].figures).toEqual([
      { kind: "chart", spec: "Temperatures" },
    ]);
    expect(totalLength(outline)).toBe(3500);
  });

  it("reads key points one a line, keeping blank lines while typing", () => {
    expect(keyPointsFrom(keyPointsText(["a", "b"]))).toEqual(["a", "b"]);
    expect(keyPointsFrom("a\n")).toEqual(["a", ""]);
  });
});
