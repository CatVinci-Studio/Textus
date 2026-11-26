import { describe, expect, it } from "vitest";
import {
  PAGE_PALETTES,
  SYNTAX_PALETTES,
  paletteVariables,
} from "./workshop-palettes";

const luminance = (hex: string) =>
  [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const FORMS = ["light", "dark"] as const;
/** The default theme's code backgrounds (base.css). */
const DEFAULT_CODE_BG = { light: "#f5f5f7", dark: "#2c2c2e" };

describe("page palettes", () => {
  it.each(PAGE_PALETTES.map((p) => [p.id, p]))(
    "%s: text, secondary text and links read on the page, code text on code (AA)",
    (_, palette) => {
      for (const form of FORMS) {
        const c = palette[form];
        for (const ink of [c.text, c.muted, c.accent])
          expect(contrast(ink, c.bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.text, c.codeBg)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it("are dark in dark and light in light", () => {
    for (const p of PAGE_PALETTES)
      expect(luminance(p.dark.bg)).toBeLessThan(luminance(p.light.bg));
  });
});

describe("code palettes", () => {
  it.each(SYNTAX_PALETTES.map((p) => [p.id, p]))(
    "%s: every token reads on every page palette's code and the default's (AA)",
    (_, palette) => {
      for (const form of FORMS) {
        const backgrounds = [
          ...PAGE_PALETTES.map((p) => p[form].codeBg),
          DEFAULT_CODE_BG[form],
        ];
        for (const token of Object.values(palette[form]))
          for (const bg of backgrounds)
            expect(contrast(token, bg)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});

describe("paletteVariables", () => {
  it("sets nothing for the theme's own", () => {
    expect(paletteVariables("", "", false)).toEqual([]);
  });

  it("sets the page's variables and the tokens, per appearance", () => {
    const light = Object.fromEntries(paletteVariables("moss", "harbor", false));
    const dark = Object.fromEntries(paletteVariables("moss", "harbor", true));
    expect(light["--doc-bg"]).toBe("#f5f7f1");
    expect(dark["--doc-bg"]).toBe("#151a13");
    expect(light["--doc-quote-border"]).toBe("#93ad86");
    expect(light["--doc-token-keyword"]).toBe("#1d5fa8");
    expect(dark["--doc-token-tag"]).toBe("#f095b5");
    // Only the document's: never the window's.
    expect(Object.keys(light).every((k) => k.startsWith("--doc-"))).toBe(true);
  });
});
