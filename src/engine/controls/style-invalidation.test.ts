import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Rules that make Chromium restyle the whole page whenever an element is
// added anywhere: a sibling rule onto anything ("a + *"), ":root:has(...)",
// and in the editor a sibling rule onto its top-level blocks, which restyles
// all of them on each one added. Kept out of the app's own stylesheets here.

const root = join(__dirname, "../..");

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
const siblingOntoBlocks = (sel: string) =>
  /\.ProseMirror ?> ?[^ ]+ ?[+~]/.test(sel) ||
  /[+~] ?\.ProseMirror-widget\b[^ ]*$/.test(sel);

describe("the app's stylesheets", () => {
  it("have no rule that makes adding an element restyle the page", () => {
    const found: string[] = [];
    for (const file of cssFiles(root))
      for (const sel of selectors(readFileSync(file, "utf8")))
        if (
          bareSiblingOntoAnything(sel) ||
          rootHas(sel) ||
          siblingOntoBlocks(sel)
        )
          found.push(`${file.slice(root.length + 1)}: ${sel}`);
    expect(found).toEqual([]);
  });

  it("catch each kind", () => {
    expect(siblingOntoBlocks(".ProseMirror > .a + .ProseMirror-widget")).toBe(
      true,
    );
    expect(siblingOntoBlocks(".ProseMirror > p + p")).toBe(true);
    expect(siblingOntoBlocks(".ProseMirror li + li")).toBe(false);
    expect(bareSiblingOntoAnything(".a + *")).toBe(true);
    expect(bareSiblingOntoAnything(".shell > .a + *")).toBe(false);
    expect(rootHas(":root:has(.x) .y")).toBe(true);
    expect(rootHas(':root[data-x="y"] .z')).toBe(false);
  });
});
