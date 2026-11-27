// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { builtinThemeCss, type BuiltinSources } from "./builtin-base";
import {
  NO_CHOICES,
  typographyCss,
  type TypeChoices,
} from "./theme-typography";
import { allowedThemeCss } from "./theme-allowlist";

// Read from disk: vitest stubs CSS imports, ?raw included.
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const sources: BuiltinSources = {
  tokens: read("../engine/tokens/base.css"),
  themes: `${read("./content-themes.css")}\n${read("./frame-themes.css")}`,
  contentBase: read("./content-base.css"),
};

const STACKS = {
  body: '"PingFang SC", sans-serif',
  heading: '"PingFang SC", sans-serif',
  code: "Menlo, monospace",
};

const ALL: TypeChoices = {
  bodyFont: "Georgia",
  headingFont: "Avenir Next",
  codeFont: "JetBrains Mono",
  fontSize: 17,
  headingRatio: 1.2,
  lineHeight: 1.7,
  width: 720,
  paragraphGap: 1,
  indent: 2,
  palette: "",
  syntax: "",
};

/** Every `selector property` the stylesheet sets, as the parser reads it. */
function declarations(css: string): string[] {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  return Array.from(sheet.cssRules).flatMap((rule) =>
    rule instanceof CSSStyleRule
      ? Array.from(rule.style, (name) => `${rule.selectorText} ${name}`)
      : [],
  );
}

describe("typographyCss", () => {
  it("writes nothing for what follows the theme", () => {
    expect(typographyCss(NO_CHOICES, STACKS)).toBe("");
  });

  it("writes only what changed", () => {
    const css = typographyCss({ ...NO_CHOICES, fontSize: 18 }, STACKS);
    expect(css).toBe(
      ":root {\n  --doc-font-size: 18px;\n}\n\n#write {\n  font-size: var(--doc-font-size);\n}",
    );
  });

  it("puts a chosen face before the theme's own stack", () => {
    const css = typographyCss({ ...NO_CHOICES, bodyFont: "Georgia" }, STACKS);
    expect(css).toContain('--doc-font: "Georgia", "PingFang SC", sans-serif;');
    expect(css).toContain("font-family: var(--doc-font);");
  });

  it("sets the variables Textus reads and the rules a Typora theme needs", () => {
    const css = typographyCss(ALL, STACKS);
    expect(css).toContain(
      '--doc-mono-font: "JetBrains Mono", Menlo, monospace;',
    );
    expect(css).toContain("--doc-line-height: 1.7;");
    expect(css).toContain("max-width: 720px;");
    expect(css).toContain("--doc-gap: 1em;");
    expect(css).toContain(
      "#write > p:not(.image-paragraph) {\n  text-indent: 2em;",
    );
    // A modular scale from h3 up.
    expect(css).toContain("#write h1 {\n  font-size: 1.728em;");
    expect(css).toContain("#write h2 {\n  font-size: 1.44em;");
    expect(css).toContain("#write h3 {\n  font-size: 1.2em;");
  });

  it("keeps every rule through the theme allowlist", () => {
    const css = typographyCss(ALL, STACKS);
    expect(declarations(allowedThemeCss(css)!).sort()).toEqual(
      declarations(css).sort(),
    );
  });
});

describe("builtinThemeCss", () => {
  it("restates Paper's palette in light and dark, over the default's", () => {
    const { light, dark } = builtinThemeCss("paper", sources);
    expect(light).toContain("--doc-bg: #faf6ee;");
    expect(light).toContain("--doc-highlight-bg:");
    expect(light).toContain("Charter");
    expect(dark).toContain("--doc-bg: #1f1b16;");
    expect(dark).not.toContain("#faf6ee");
    // The font is shared: the dark blocks don't restate it.
    expect(dark).toContain("Charter");
  });

  it("gives the default its own palette, ornaments and type", () => {
    const { light, dark } = builtinThemeCss("default", sources);
    expect(light).toContain("--doc-bg: #ffffff;");
    expect(dark).toContain("--doc-bg: #1c1c1e;");
    expect(light).toContain("--ui-bg: #ffffff;");
    expect(dark).toContain("--ui-bg: #1c1c1e;");
    expect(light).toContain("#write h2 {");
    expect(light).toContain("line-height: var(--doc-line-height, 1.8);");
    expect(light).toContain(
      ":root[data-early-containers] #write {\n  font-size: calc(var(--doc-font-size, 1.03125rem) * var(--doc-step, 1));",
    );
    expect(light).not.toContain("data-user-theme");
  });

  it("carries Prism's frame colours", () => {
    const { light, dark } = builtinThemeCss("prism", sources);
    expect(light).toContain(
      "--ui-frame-paint: linear-gradient(170deg, #6ec5e6",
    );
    expect(dark).toContain("--ui-frame-paint: linear-gradient(170deg, #0f3346");
  });
});
