import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Two kinds of style rule made Chromium restyle the whole page whenever an
// element was added anywhere - Enter in a 5k-block document recalculated
// the style of every block, 30 ms each time, and more as the document grew:
//
// - a sibling rule onto anything with nothing above it, "a + *": every
//   sibling after the new element was restyled;
// - ":root:has(...)": the whole page was checked again.
//
// Found with a trace of Enter (StyleInvalidatorInvalidationTracking); kept
// out of the app's own stylesheets here.

const root = join(__dirname, "..");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

/** Each rule's selectors, comments and at-rule preludes left out. */
function selectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  for (const match of text.matchAll(/([^{}]+)\{/g)) {
    const prelude = match[1].trim();
    if (prelude.startsWith("@")) continue;
    out.push(...prelude.split(",").map((s) => s.replace(/\s+/g, " ").trim()));
  }
  return out;
}

const bareSiblingOntoAnything = (sel: string) =>
  /\+ ?\*$/.test(sel) && !/>/.test(sel);
const rootHas = (sel: string) => /^:root:has\(/.test(sel);

describe("the app's stylesheets", () => {
  it("have no rule that makes adding an element restyle the page", () => {
    const found: string[] = [];
    for (const file of cssFiles(root))
      for (const sel of selectors(readFileSync(file, "utf8")))
        if (bareSiblingOntoAnything(sel) || rootHas(sel))
          found.push(`${file.slice(root.length + 1)}: ${sel}`);
    expect(found).toEqual([]);
  });

  it("catch both kinds", () => {
    expect(bareSiblingOntoAnything(".a + *")).toBe(true);
    expect(bareSiblingOntoAnything(".shell > .a + *")).toBe(false);
    expect(rootHas(":root:has(.x) .y")).toBe(true);
    expect(rootHas(':root[data-x="y"] .z')).toBe(false);
  });
});
