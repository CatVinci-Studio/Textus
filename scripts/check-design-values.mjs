#!/usr/bin/env node
// The interface's CSS keeps to the design tokens (docs/dev/design-tokens.md):
// radii and shadows come from tokens, spacing stays on the 4-point scale
// (text sizes: check-text-sizes.mjs). A line that must differ says why
// with "design: allow" on it or the line above. Exits 1 with a list of what strays.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../src/", import.meta.url).pathname;
// Spacing steps; 1 and 2 for hairlines and nudges.
const SPACING = new Set([0, 1, 2, 4, 8, 12, 16, 24, 32, 40, 48]);
// Radii a token doesn't name: none, a hairline's.
const RADII = new Set([0, 1]);

const RULES = [
  {
    name: "border-radius in px (use a --shape-* token)",
    test: (prop, value) =>
      /^border(-[a-z]+)*-radius$/.test(prop) &&
      !value.includes("var(") &&
      [...value.matchAll(/(\d*\.?\d+)px/g)].some(
        ([, n]) => !RADII.has(Number(n)),
      ),
  },
  {
    name: "box-shadow with a raw blur (use a --shadow-* token)",
    test: (prop, value) =>
      prop === "box-shadow" &&
      !value.startsWith("var(") &&
      value.split(/,(?![^(]*\))/).some((layer) => {
        const lengths = [
          ...layer.matchAll(/(-?\d*\.?\d+)px|(?<![\w.])0(?![\w.%])/g),
        ];
        const blur = lengths[2]?.[1];
        return blur !== undefined && Number(blur) > 0;
      }),
  },
  {
    name: "spacing off the 4-point scale",
    test: (prop, value) =>
      /^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)*$/.test(prop) &&
      [...value.matchAll(/(?<![\w-])(\d*\.?\d+)px/g)].some(
        ([, n]) => !SPACING.has(Number(n)),
      ),
  },
];

function* cssFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* cssFiles(path);
    else if (name.endsWith(".css")) yield path;
  }
}

const strays = [];
for (const file of cssFiles(ROOT)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const decl = line.match(/^\s*([a-z-]+)\s*:\s*(.+?);?\s*$/);
    if (!decl) return;
    const allowed =
      /design: allow/.test(line) || /design: allow/.test(lines[i - 1] ?? "");
    if (allowed) return;
    const [, prop, value] = decl;
    for (const rule of RULES)
      if (rule.test(prop, value))
        strays.push(
          `${relative(process.cwd(), file)}:${i + 1}  ${rule.name}: ${line.trim()}`,
        );
  });
}

if (strays.length) {
  console.log(strays.join("\n"));
  console.log(`\n${strays.length} value(s) off the design tokens.`);
  process.exit(1);
}
console.log("Design values: all on the tokens.");
