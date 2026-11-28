import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// What flips on the document's ancestors as the sidebar or the AI panel
// opens must not restyle the document under them: a custom property
// changes for everything below where it is set (custom properties are
// inherited), and a selector keyed on an attribute whose value flips makes
// the engine re-check everything it may reach. Either restyled all of a
// long document (thousands of elements) on a toggle's first frame.

const SRC = fileURLToPath(new URL("../..", import.meta.url));

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return stylesheets(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

/** Each rule's selector and body, comments dropped (nested rules flat). */
function rules(css: string): { selector: string; body: string }[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selector: string; body: string }[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = rule.exec(plain); m; m = rule.exec(plain))
    out.push({ selector: m[1]!.trim().replace(/\s+/g, " "), body: m[2]! });
  return out;
}

const all = stylesheets(SRC).flatMap((file) =>
  rules(readFileSync(file, "utf8")).map((r) => ({
    ...r,
    file: relative(SRC, file),
  })),
);

describe("what a toggle restyles", () => {
  it("keys no style on which tab is in use (it flips as the AI opens)", () => {
    const keyed = all.filter((r) => r.selector.includes("[data-active-tab"));
    expect(keyed.map((r) => `${r.file}: ${r.selector}`)).toEqual([]);
  });

  it("sets no custom property by the sidebar's open state on the shell", () => {
    const set = all.filter(
      (r) =>
        /\.app-shell[^\s>+~,]*\[data-sidebar/.test(r.selector) &&
        /(^|[;\s])--[\w-]+\s*:/.test(r.body) &&
        // A phone pushes its page aside instead: no long relayout to spare.
        !r.selector.includes('[data-window-chrome="mobile"] .app-shell'),
    );
    expect(set.map((r) => `${r.file}: ${r.selector}`)).toEqual([]);
  });
});
