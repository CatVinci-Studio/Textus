import { describe, expect, it } from "vitest";
import { adaptTyporaCss, namedSystemFonts } from "./typora-compat";

describe("adaptTyporaCss", () => {
  it("maps thead selectors onto the header row", () => {
    expect(adaptTyporaCss("#write thead th { color: red }")).toBe(
      "#write tr[data-is-header] th { color: red }",
    );
    expect(adaptTyporaCss("table thead > tr { x: y }")).toBe(
      "table tr[data-is-header] { x: y }",
    );
    expect(adaptTyporaCss("thead tr th, thead { x: y }")).toBe(
      "tr[data-is-header] th, tr[data-is-header] { x: y }",
    );
  });

  it("leaves unrelated selectors alone", () => {
    const css = "#write .theader, tbody tr:nth-child(2n) { x: y }";
    expect(adaptTyporaCss(css)).toBe(css);
  });
});

describe("namedSystemFonts", () => {
  it("names the system faces a theme asks for by their generic families", () => {
    expect(
      namedSystemFonts(
        '#write { font-family: -apple-system, "PingFang SC", sans-serif; }\n' +
          "code { font: 14px ui-monospace, Menlo }\nh1 { font-family: ui-serif }",
      ),
    ).toBe(
      '#write { font-family: "SF Pro Text", "PingFang SC", sans-serif; }\n' +
        'code { font: 14px "SF Mono", Menlo }\nh1 { font-family: "New York" }',
    );
  });

  it("leaves names that only contain one alone", () => {
    const css = ".system-ui-note { --ui-serif-size: 2px; }";
    expect(namedSystemFonts(css)).toBe(css);
  });
});
