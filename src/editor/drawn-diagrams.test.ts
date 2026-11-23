import { describe, expect, it } from "vitest";
import {
  DRAWINGS_KEPT,
  drawingFor,
  keepDrawing,
  lastDrawing,
} from "./drawn-diagrams";
import type { Drawn } from "./mermaid-blocks";

const drawn = (style: string, id: number): Drawn => ({
  svg: `<svg>${id}</svg>`,
  engine: "mermaid",
  style,
  id,
});

describe("drawings shared by every editor", () => {
  it("finds a drawing by its source and what it was drawn for", () => {
    const narrow = drawn("400|serif", 1);
    const wide = drawn("800|serif", 2);
    keepDrawing("graph A", narrow);
    keepDrawing("graph A", wide);
    expect(drawingFor("graph A", ["400|serif"])).toBe(narrow);
    expect(drawingFor("graph A", ["600|serif", "800|serif"])).toBe(wide);
    expect(drawingFor("graph A", ["600|serif"])).toBeUndefined();
    expect(lastDrawing("graph A")).toBe(wide);
  });

  it("lets the stalest go past its bound", () => {
    keepDrawing("first", drawn("s", 0));
    for (let i = 1; i <= DRAWINGS_KEPT; i++)
      keepDrawing(`g${i}`, drawn("s", i));
    expect(lastDrawing("first")).toBeUndefined();
    expect(drawingFor("first", ["s"])).toBeUndefined();
    expect(lastDrawing(`g${DRAWINGS_KEPT}`)?.id).toBe(DRAWINGS_KEPT);
  });
});
