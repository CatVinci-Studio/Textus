import { describe, expect, it } from "vitest";
import katex from "katex";
import { renderFormula, spaceMatrixRows } from "./matrix-rows";

describe("matrix row spacing", () => {
  it("stretches the rows of each matrix, and only matrices", () => {
    expect(spaceMatrixRows("\\begin{vmatrix}a\\\\b\\end{vmatrix}")).toBe(
      "\\begingroup\\def\\arraystretch{1.4}\\begin{vmatrix}a\\\\b\\end{vmatrix}\\endgroup",
    );
    expect(spaceMatrixRows("\\begin{pmatrix*}[r]1\\end{pmatrix*}")).toContain(
      "\\begingroup",
    );
    for (const other of [
      "\\begin{aligned}a\\\\b\\end{aligned}",
      "\\begin{smallmatrix}a\\\\b\\end{smallmatrix}",
      "\\def\\arraystretch{2}\\begin{matrix}a\\\\b\\end{matrix}",
    ])
      expect(spaceMatrixRows(other)).toBe(other);
  });

  it("leaves room between rows of fractions", () => {
    const source =
      "\\begin{vmatrix}\\frac{a}{b}&0\\\\\\frac{c}{d}&0\\end{vmatrix}";
    const plain = katex.renderToString(source);
    const spaced = renderFormula(katex, source, {});
    expect(spaced).not.toBe(plain);
    expect(spaced).not.toContain("katex-error");
  });

  it("shows a formula it can't read as the source typed", () => {
    const html = renderFormula(katex, "\\begin{bmatrix}a\\end{bmatrix}^", {
      throwOnError: false,
    });
    expect(html).toContain("katex-error");
    expect(html).not.toContain("begingroup");
  });
});
