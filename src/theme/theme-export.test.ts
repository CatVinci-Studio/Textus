import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ornamentRules } from "./theme-export";

// Read from disk: vitest stubs CSS imports, ?raw included.
const contentBaseCss = readFileSync(
  new URL("./content-base.css", import.meta.url),
  "utf8",
);

describe("ornamentRules", () => {
  it("rewrites the ornament rules as #write rules", () => {
    const css = `@layer x {
  .milkdown h2 { margin: 0; }
  /* note */
  :root:not([data-user-theme]) .milkdown h2 {
    padding-bottom: 0.3em;
    border-bottom: 1px solid var(--editor-border);
  }
}`;
    expect(ornamentRules({ css })).toBe(
      "#write h2 {\n  padding-bottom: 0.3em;\n  border-bottom: 1px solid var(--editor-border);\n}",
    );
  });

  it("carries every ornament content-base.css has (#29)", () => {
    const rules = ornamentRules({ css: contentBaseCss });
    expect(rules).toContain("#write h2 {");
    expect(rules).toContain("#write h3 {");
    expect(rules).toContain("#write h4::before {");
    expect(rules).toContain("#write blockquote {");
    expect(rules).toContain("#write th {");
    expect(rules).not.toContain("data-user-theme");
    expect(rules).not.toContain("/*");
  });

  it("leaves out the h3 bar and h4 dot when heading marks are off (#136)", () => {
    const rules = ornamentRules({ css: contentBaseCss, headingMarks: false });
    expect(rules).not.toContain("#write h3 {");
    expect(rules).not.toContain("#write h4::before {");
    expect(rules).toContain("#write h2 {");
    expect(rules).toContain("#write blockquote {");
    expect(rules).not.toContain("data-no-heading-marks");
  });

  it("switches off only the h3 bar and h4 dot, not the h2 rule", () => {
    const flat = contentBaseCss
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ");
    const off =
      ":root:not([data-user-theme]):not([data-no-heading-marks]) .milkdown ";
    expect(flat).toContain(`${off}h3 {`);
    expect(flat).toContain(`${off}h4::before {`);
    expect(flat).toContain(":root:not([data-user-theme]) .milkdown h2 {");
    expect(flat.match(/data-no-heading-marks/g)).toHaveLength(2);
  });
});
