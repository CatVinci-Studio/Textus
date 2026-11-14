import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast } from "../engine/tokens/palette";
import { DOC_DEFAULTS } from "../engine/tokens/doc-defaults";
const css = readFileSync(
  new URL("./content-themes.css", import.meta.url),
  "utf8",
);
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
  .filter((match) => match[2].includes("--doc-bg:"))
  .map((match) => ({
    selector: match[1].trim().split("\n").slice(-1)[0],
    values: Object.fromEntries(
      [...match[2].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [
        m[1],
        m[2],
      ]),
    ),
  }));
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
describe("built-in theme display contract", () => {
  for (const theme of ["paper", "slate", "forest"]) {
    const variants = blocks.filter((b) => b.selector.includes(`"${theme}"`));
    it(`${theme}: system dark matches explicit dark and never changes chrome`, () => {
      expect(variants).toHaveLength(3);
      expect(variants[1].values).toEqual(variants[2].values);
      for (const block of variants) {
        expect(
          Object.keys(block.values).every((key) => key.startsWith("--doc-")),
        ).toBe(true);
      }
    });
    for (const [index, variant] of variants.entries()) {
      it(`${theme} variant ${index}: text, links and hints remain legible`, () => {
        for (const fg of ["--doc-text", "--doc-muted", "--doc-accent"]) {
          for (const bg of ["--doc-bg", "--doc-code-bg"]) {
            expect(
              contrast(rgb(variant.values[fg]), rgb(variant.values[bg])),
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      });
    }
  }
});

const frameCss = readFileSync(
  new URL("./frame-themes.css", import.meta.url),
  "utf8",
);
const frameBlocks = [...frameCss.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
  .filter((match) => match[2].includes("--ui-frame-paint:"))
  .map((match) => ({
    selector: match[1].trim().split("\n").slice(-1)[0],
    values: Object.fromEntries(
      [...match[2].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [
        m[1],
        m[2].replace(/\s+/g, " ").trim(),
      ]),
    ),
  }));
describe("the built-in frame theme", () => {
  for (const theme of ["aurora"]) {
    const variants = frameBlocks.filter((b) =>
      b.selector.includes(`"${theme}"`),
    );
    it(`${theme}: system dark matches explicit dark, the page left alone`, () => {
      expect(variants).toHaveLength(3);
      expect(variants[1].values).toEqual(variants[2].values);
      const open = [
        "--ui-frame-paint",
        "--ui-frame-tint",
        "--doc-accent",
        "--doc-mark",
      ];
      for (const block of variants)
        expect(Object.keys(block.values).every((k) => open.includes(k))).toBe(
          true,
        );
    });
    for (const [index, variant] of variants.entries()) {
      const ink = DOC_DEFAULTS[index === 0 ? "light" : "dark"];
      it(`${theme} variant ${index}: links on the page and the frame's text read`, () => {
        expect(
          contrast(rgb(variant.values["--doc-accent"]), rgb(ink.bg)),
        ).toBeGreaterThanOrEqual(4.5);
        const stops =
          variant.values["--ui-frame-paint"].match(/#[0-9a-f]{6}/gi)!;
        expect(stops.length).toBeGreaterThanOrEqual(2);
        for (const stop of stops)
          expect(contrast(rgb(ink.text), rgb(stop))).toBeGreaterThanOrEqual(
            4.5,
          );
      });
    }
  }
});
