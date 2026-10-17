import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { keepWoff2Sources } from "./vite.katex-fonts";

const katexDist = dirname(
  createRequire(import.meta.url).resolve("katex/dist/katex.min.css"),
);
const fontFaces = (css: string) => css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
const urls = (rule: string) =>
  (rule.match(/url\([^)]*\)/g) ?? []).map((url) =>
    url.replace(/^url\(\s*["']?|["']?\s*\)$/g, ""),
  );

describe("keepWoff2Sources", () => {
  for (const file of ["katex.min.css", "katex.css"]) {
    it(`leaves every @font-face in ${file} one woff2 file that exists`, () => {
      const css = readFileSync(join(katexDist, file), "utf8");
      const before = fontFaces(css);
      const after = fontFaces(keepWoff2Sources(css));
      expect(before.length).toBeGreaterThan(0);
      expect(after).toHaveLength(before.length);
      for (const rule of after) {
        const [only, ...rest] = urls(rule);
        expect(rest, rule).toEqual([]);
        expect(only, rule).toMatch(/\.woff2$/);
        expect(existsSync(join(katexDist, only)), only).toBe(true);
      }
    });

    it(`changes nothing in ${file} but the font sources`, () => {
      const css = readFileSync(join(katexDist, file), "utf8");
      const strip = (s: string) => s.replace(/@font-face\s*\{[^}]*\}/g, "");
      expect(strip(keepWoff2Sources(css))).toBe(strip(css));
    });
  }

  it("keeps a src list that has no woff2 entry", () => {
    const css = `@font-face{font-family:X;src:url(x.ttf) format("truetype")}`;
    expect(keepWoff2Sources(css)).toBe(css);
  });
});
