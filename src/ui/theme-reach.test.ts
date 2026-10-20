import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// An imported Typora theme recolours the whole window through the colour
// tokens (ui/design-system.css, ui/base.css), which theme/theme-chrome.ts
// derives from the theme's page and its own `:root` may set: a colour
// written straight into a rule is one place no theme reaches. Rules take
// tokens; a literal is allowed only where it is not a colour on screen.

const SRC = fileURLToPath(new URL("..", import.meta.url));

/** Not part of the window a theme recolours: the document themes
 *  themselves, the browser playground's page, a printout on paper. */
const OUTSIDE = ["theme/", "playground/", "export/print.css"];
/** Windows' own caption colour: its close button turns this red on every
 *  theme, as the system's does. */
const FIXED = ["ui/window-caption.css"];

const LITERAL =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(\s*[\d.]|(?<![-\w])(?:white|black)(?![-\w])/i;

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

/** The declarations of a stylesheet that draw a colour, with what may
 *  legitimately hold a literal taken out first. */
function literalColours(css: string): string[] {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  for (const raw of body.split(/[;{}]/)) {
    const decl = raw.trim();
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim();
    // Tokens are where colours are defined; masks only read alpha.
    if (prop.startsWith("--") || /mask/.test(prop)) continue;
    const value = decl
      .slice(colon + 1)
      .replace(/url\([^)]*\)/g, "")
      // A token's fallback, for an engine or a page without it.
      .replace(/var\(\s*--[\w-]+\s*,[^()]*(?:\([^()]*\)[^()]*)*\)/g, "")
      // A token shaded towards black or white is the token's colour.
      .replace(
        /color-mix\(\s*in \w+\s*,\s*var\([^)]*\)\s*\d+%\s*,\s*(?:#000|#fff|black|white)\s*\)/g,
        "",
      );
    if (LITERAL.test(value)) found.push(`${prop}: ${value.trim()}`);
  }
  return found;
}

describe("the interface's colours", () => {
  it("come from tokens a theme can reach, never a literal in a rule", () => {
    const offenders: string[] = [];
    for (const path of stylesheets(SRC)) {
      const rel = relative(SRC, path).replace(/\\/g, "/");
      if (OUTSIDE.some((p) => rel.startsWith(p)) || FIXED.includes(rel))
        continue;
      for (const decl of literalColours(readFileSync(path, "utf8")))
        offenders.push(`${rel}: ${decl}`);
    }
    expect(offenders).toEqual([]);
  });

  it("tell a literal from a token, a fallback or a mask", () => {
    expect(literalColours(".a { color: #fff; }")).toHaveLength(1);
    expect(
      literalColours(".a { box-shadow: 0 1px 2px rgb(0 0 0 / 10%); }"),
    ).toHaveLength(1);
    expect(
      literalColours(`.a {
        --x: #fff;
        color: var(--x, #fff);
        mask-image: linear-gradient(#000, transparent);
        background: color-mix(in srgb, var(--danger-fill) 86%, #000);
        white-space: nowrap;
      }`),
    ).toEqual([]);
  });
});
