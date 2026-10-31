import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The interface spaces things on a 4px grid: every padding, margin and gap in
// px is a multiple of 4, or a hairline's 1-2px. The document's own type
// (themes, the editor's content, print) keeps its typographic spacing.

const SRC = fileURLToPath(new URL("..", import.meta.url));
const TYPOGRAPHY = [
  "theme/",
  "editor/milkdown-theme.css",
  "export/print.css",
  "playground/",
];

const SPACING =
  /^\s*(?:padding|margin|gap|row-gap|column-gap)[a-z-]*\s*:\s*([^;{}]+)/gm;

describe("spacing on the 4px grid", () => {
  const files = readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".css"))
    .map((file) => file.split(sep).join("/"))
    .filter((file) => !TYPOGRAPHY.some((skip) => file.startsWith(skip)));

  it("finds the stylesheets", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const name of files)
    it(name, () => {
      const css = readFileSync(join(SRC, name), "utf8").replace(
        /\/\*[\s\S]*?\*\//g,
        "",
      );
      const off = [...css.matchAll(SPACING)]
        .filter((m) =>
          [...m[1].matchAll(/(?<![\w.])-?(\d+)px\b/g)].some(
            ([, n]) => Number(n) > 2 && Number(n) % 4 !== 0,
          ),
        )
        .map((m) => m[0].trim());
      expect(off).toEqual([]);
    });
});
