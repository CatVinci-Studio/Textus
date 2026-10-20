import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import {
  COLOR_MIX_UNSUPPORTED,
  colorMixFallback,
  lowerColorMix,
} from "./vite.color-mix-fallback";

const run = (css: string) =>
  postcss([colorMixFallback()]).process(css, { from: undefined });

describe("lowerColorMix", () => {
  it("draws a light tint of a token in its hue at the same opacity", () => {
    expect(
      lowerColorMix(
        "color-mix(in srgb, var(--editor-accent) 14%, transparent)",
      ),
    ).toBe("rgb(49 94 209 / 14%)");
    expect(
      lowerColorMix(
        "color-mix(in srgb, var(--success-color) 16%, transparent)",
      ),
    ).toBe("rgb(36 115 77 / 16%)");
  });

  it("draws a light tint of text or an unknown token in grey", () => {
    expect(
      lowerColorMix("color-mix(in srgb, var(--editor-text) 6%, transparent)"),
    ).toBe("rgb(128 128 128 / 6%)");
    expect(
      lowerColorMix("color-mix(in srgb, currentColor 8%, transparent)"),
    ).toBe("rgb(128 128 128 / 8%)");
  });

  it("keeps a hex colour's own hue, also a var()'s hex fallback", () => {
    expect(
      lowerColorMix(
        "color-mix(in srgb, #8a7440 40%, var(--editor-bg, var(--bg)))",
      ),
    ).toBe("rgb(138 116 64 / 40%)");
    expect(
      lowerColorMix(
        "color-mix(in srgb, var(--chrome-muted, #888) 35%, transparent)",
      ),
    ).toBe("rgb(136 136 136 / 35%)");
  });

  it("draws a strong tint as the colour itself", () => {
    expect(
      lowerColorMix("color-mix(in srgb, var(--border-color) 75%, transparent)"),
    ).toBe("var(--border-color)");
    expect(
      lowerColorMix("color-mix(in srgb, currentColor 78%, var(--pele-bg))"),
    ).toBe("currentColor");
  });

  it("treats a mix over a background as a tint, and other mixes by weight", () => {
    expect(
      lowerColorMix("color-mix(in srgb, var(--editor-muted) 38%, var(--bg))"),
    ).toBe("rgb(128 128 128 / 38%)");
    expect(
      lowerColorMix(
        "color-mix(in srgb, var(--ui-primary) 86%, var(--ui-on-primary))",
      ),
    ).toBe("var(--ui-primary)");
    expect(
      lowerColorMix(
        "color-mix(in srgb, var(--editor-accent) 35%, var(--border-color))",
      ),
    ).toBe("var(--border-color)");
  });

  it("reads the percentage on either colour, or splits evenly", () => {
    expect(
      lowerColorMix("color-mix(in srgb, transparent, var(--danger) 30%)"),
    ).toBe("rgb(190 54 75 / 30%)");
    expect(lowerColorMix("color-mix(in oklab, red, blue)")).toBe("red");
  });

  it("drops a tint of the background itself", () => {
    expect(
      lowerColorMix(
        "color-mix(in srgb, var(--editor-bg, var(--bg)) 20%, transparent)",
      ),
    ).toBe("transparent");
  });

  it("replaces each mix inside a longer value", () => {
    expect(
      lowerColorMix(
        "0 0 0 1px color-mix(in srgb, var(--danger) 30%, transparent), 0 1px 2px color-mix(in srgb, #000 20%, transparent)",
      ),
    ).toBe("0 0 0 1px rgb(190 54 75 / 30%), 0 1px 2px rgb(0 0 0 / 20%)");
  });
});

describe("colorMixFallback", () => {
  it("follows a rule with its plain-colour twin for engines without color-mix", async () => {
    const { root } = await run(
      ".a { color: red; background: color-mix(in srgb, var(--editor-text) 6%, transparent); }",
    );
    const [rule, supports] = root.nodes as [postcss.Rule, postcss.AtRule];
    expect(rule.toString()).toContain("background: color-mix(");
    expect(supports.params).toBe(COLOR_MIX_UNSUPPORTED);
    expect(supports.first?.toString()).toBe(
      ".a { background: rgb(128 128 128 / 6%); }",
    );
  });

  it("keeps the twin inside the rule's @media and !important", async () => {
    const { root } = await run(
      "@media (prefers-color-scheme: dark) { :root { --x: color-mix(in srgb, var(--danger) 12%, transparent) !important; } }",
    );
    const media = root.first as postcss.AtRule;
    const supports = media.last as postcss.AtRule;
    expect(supports.params).toBe(COLOR_MIX_UNSUPPORTED);
    const decl = (supports.first as postcss.Rule).first as postcss.Declaration;
    expect([decl.prop, decl.value, decl.important]).toEqual([
      "--x",
      "rgb(190 54 75 / 12%)",
      true,
    ]);
  });

  it("warns on a mix inside @keyframes, where no @supports may go", async () => {
    const result = await run(
      "@keyframes k { to { color: color-mix(in srgb, red 50%, blue); } }",
    );
    expect(result.warnings()).toHaveLength(1);
    expect(result.css).not.toContain("@supports");
  });
});

describe("the app's stylesheets", () => {
  const cssFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return cssFiles(path);
      return name.endsWith(".css") ? [path] : [];
    });

  it("get a plain-colour fallback for every color-mix()", async () => {
    const warnings: string[] = [];
    for (const path of cssFiles(join(__dirname, "src"))) {
      const result = await postcss([colorMixFallback()]).process(
        readFileSync(path, "utf8"),
        { from: path },
      );
      warnings.push(...result.warnings().map((w) => `${path}: ${w.text}`));
    }
    expect(warnings).toEqual([]);
  });
});
