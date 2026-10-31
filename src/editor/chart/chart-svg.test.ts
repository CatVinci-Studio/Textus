// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseChartSpec } from "./chart-spec";
import { niceTicks, renderChart } from "./chart-svg";

const BAR = JSON.stringify({
  type: "bar",
  title: "Revenue <2024>",
  x: "Quarter",
  y: "USD m",
  labels: ["Q1", "Q2", "Q3"],
  series: [
    { name: "North", data: [3, 5, -2] },
    { name: "South", data: [4, 1, 6] },
  ],
  caption: "Figure 1.",
  source: "Annual report [3]",
});

const parse = (svg: string) =>
  new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;

describe("parseChartSpec", () => {
  it("reads a full spec", () => {
    const spec = parseChartSpec(BAR);
    expect(spec.type).toBe("bar");
    expect(spec.series.map((s) => s.name)).toEqual(["North", "South"]);
    expect(spec.source).toBe("Annual report [3]");
  });

  it("fills in a bar type, series names and labels", () => {
    const spec = parseChartSpec('{"data": [1, 2, 3]}');
    expect(spec.type).toBe("bar");
    expect(spec.series[0].name).toBe("Series 1");
    expect(spec.labels).toEqual(["1", "2", "3"]);
  });

  it.each([
    ["{not json", "not valid JSON"],
    ["[1, 2]", "a JSON object"],
    ['{"type": "radar", "data": [1]}', '"type"'],
    ['{"series": []}', "non-empty"],
    ['{"data": [1, "2"]}', "must be numbers"],
    ['{"type": "scatter", "data": [[1, 2], [3]]}', "[x, y]"],
    ['{"type": "pie", "data": [1, -1]}', "negative"],
    ['{"labels": ["a"], "data": [1, 2]}', "fewer"],
    [JSON.stringify({ series: Array(9).fill({ data: [1] }) }), "at most 8"],
  ])("refuses %s", (source, message) => {
    expect(() => parseChartSpec(source)).toThrow(message);
  });
});

describe("niceTicks", () => {
  it("covers the range with round steps", () => {
    expect(niceTicks(0, 9.3)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(-2, 6)).toEqual([-2, 0, 2, 4, 6]);
    expect(niceTicks(0, 0)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
});

describe("renderChart", () => {
  it("draws grouped bars with a legend, axes and notes, escaping text", () => {
    const svg = renderChart(BAR, { width: 600 });
    const root = parse(svg);
    expect(root.querySelector("parsererror")).toBeNull();
    expect(root.getAttribute("class")).toBe("textus-chart");
    expect(root.getAttribute("viewBox")).toMatch(/^0 0 600 \d+$/);
    expect(root.querySelectorAll('g[data-id^="series-"]')).toHaveLength(2);
    expect(root.querySelectorAll('g[data-id="series-0"] path')).toHaveLength(3);
    expect(root.querySelectorAll('rect[data-id^="key-"]')).toHaveLength(2);
    const texts = [...root.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("Revenue <2024>");
    expect(texts).toContain("Source: Annual report [3]");
    expect(texts).toContain("Quarter");
    expect(svg).not.toContain("<2024>");
  });

  it("uses the document's ink, with fallbacks for each appearance", () => {
    expect(renderChart(BAR, { width: 600 })).toContain(
      "var(--doc-text, #24272e)",
    );
    const dark = renderChart(BAR, { width: 600, dark: true });
    expect(dark).toContain("var(--doc-text, #e4e7ed)");
    expect(dark).toContain("#3987e5");
  });

  it("draws one series without a legend, and each other type", () => {
    const one = parse(
      renderChart('{"type": "line", "data": [1, 3, 2]}', { width: 400 }),
    );
    expect(one.querySelector('[data-id^="key-"]')).toBeNull();
    expect(one.querySelectorAll("circle")).toHaveLength(3);

    const area = parse(
      renderChart('{"type": "area", "data": [1, 3, 2]}', { width: 400 }),
    );
    expect(area.querySelectorAll('g[data-id="series-0"] path')).toHaveLength(2);

    const pie = parse(
      renderChart('{"type": "pie", "labels": ["a", "b"], "data": [1, 3]}', {
        width: 400,
      }),
    );
    expect(pie.querySelectorAll('[data-id^="slice-"]')).toHaveLength(2);
    expect(pie.querySelector("title")?.textContent).toBe("a: 1 (25%)");

    const scatter = parse(
      renderChart('{"type": "scatter", "data": [[1, 2], [3, 4], [5, 1]]}', {
        width: 400,
      }),
    );
    expect(scatter.querySelectorAll("circle")).toHaveLength(3);
  });

  it("is laid out within its width, and at least 320 wide", () => {
    expect(renderChart(BAR, { width: 200 })).toContain('width="320"');
    expect(renderChart(BAR, { width: 2000 })).toContain('width="760"');
  });
});
