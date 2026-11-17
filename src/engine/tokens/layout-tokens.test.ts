import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const css = readFileSync(join(__dirname, "layout-tokens.css"), "utf8");
const value = (layout: string, name: string) =>
  new RegExp(
    `\\[data-layout="${layout}"\\] \\{[^}]*?${name}:\\s*([^;]+);`,
  ).exec(css)?.[1];

// The two layouts differ in corners, gaps and lines; a tab stands as tall
// in both, not the whole row in Classic.
it("gives a tab the same height in both layouts", () => {
  expect(value("classic", "--tab-lift")).toBe(value("islands", "--tab-lift"));
});
