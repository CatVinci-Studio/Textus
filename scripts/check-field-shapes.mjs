#!/usr/bin/env node
// A field one types into - a line or several, in the app or a plugin page -
// is a rounded rectangle, not a capsule (design-language.md 6): capsules are
// for buttons, selects, chips, tags, segments and switches. Fails on a rule
// that draws a text field with --shape-pill.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FIELD =
  /(input(?!\[type="(checkbox|radio|range|color)"\])|textarea|search|-field\b|-input\b|\.tx-input|query)/i;
const NOT_FIELD =
  /checkbox|radio|switch|button|chip|tag|segment|select(?!or)|toggle/i;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "mobile") yield* files(path);
    } else if (name.endsWith(".css")) yield path;
  }
}

const problems = [];
for (const file of files("src")) {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!body.includes("--shape-pill")) continue;
    if (!FIELD.test(selector) || NOT_FIELD.test(selector)) continue;
    problems.push(
      `${file}: ${selector.trim().replace(/\s+/g, " ")} - a field is --shape-s, not a capsule`,
    );
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("field shapes: every text field is a rounded rectangle");
