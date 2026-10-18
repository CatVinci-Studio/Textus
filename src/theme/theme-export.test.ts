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
    expect(ornamentRules(css)).toBe(
      "#write h2 {\n  padding-bottom: 0.3em;\n  border-bottom: 1px solid var(--editor-border);\n}",
    );
  });

  it("carries every ornament content-base.css has (#29)", () => {
    const rules = ornamentRules(contentBaseCss);
    expect(rules).toContain("#write h2 {");
    expect(rules).toContain("#write h3 {");
    expect(rules).toContain("#write h4::before {");
    expect(rules).toContain("#write blockquote {");
    expect(rules).toContain("#write th {");
    expect(rules).not.toContain("data-user-theme");
    expect(rules).not.toContain("/*");
  });
});
