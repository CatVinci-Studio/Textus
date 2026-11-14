import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The frame's fill may be a gradient (--ui-frame-paint): every piece lays it
// against the window, so one gradient runs across the bar, rail, sidebar and
// gaps; where a solid colour is needed (a mix, a shadow) the frame colour is
// used instead, as a gradient there is no value at all.

const SRC = join(__dirname, "../..");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

/** Each declaration that names the fill, with where it is. */
function uses(): { at: string; decl: string }[] {
  return cssFiles(SRC).flatMap((path) => {
    const text = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    return [...text.matchAll(/([\w-]+)\s*:([^;{}]*);/g)]
      .filter(
        ([, prop, value]) =>
          prop === "--ui-frame-fill" ||
          (!prop.startsWith("--") && value.includes("--ui-frame-fill")),
      )
      .map(([decl]) => ({
        at: relative(SRC, path),
        decl: decl.replace(/\s+/g, " "),
      }));
  });
}

describe("the frame's fill", () => {
  const all = uses();

  it("is found", () => {
    expect(all.length).toBeGreaterThan(5);
  });

  it("is painted against the window wherever it is a background", () => {
    const loose = all.filter(
      ({ decl }) => decl.startsWith("background:") && !/\bfixed;$/.test(decl),
    );
    expect(loose).toEqual([]);
  });

  it("is never mixed or cast as a shadow, where a gradient can't go", () => {
    const solid = all.filter(
      ({ decl }) =>
        !decl.startsWith("background:") && !decl.startsWith("--ui-frame-fill"),
    );
    expect(solid).toEqual([]);
  });

  it("takes the paint wherever it is declared", () => {
    const unpainted = all.filter(
      ({ decl }) =>
        decl.startsWith("--ui-frame-fill") &&
        !decl.includes("--ui-frame-paint"),
    );
    expect(unpainted).toEqual([]);
  });
});
