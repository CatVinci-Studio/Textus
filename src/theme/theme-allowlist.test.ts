// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allowedThemeCss } from "./theme-allowlist";

const reply = readFileSync("src/theme/fixtures/theme-skill-reply.md", "utf8");
const sample = /```css\n([\s\S]*?)\n```/.exec(reply)![1];

/** Every `property: value` the stylesheet sets, as the parser reads it. */
function declarations(css: string): string[] {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const out: string[] = [];
  const walk = (rules: CSSRuleList, at: string) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule)
        for (const name of Array.from(rule.style))
          out.push(`${at}${rule.selectorText} ${name}`);
      else if ("cssRules" in rule)
        walk(rule.cssRules as CSSRuleList, `${rule.cssText.split("{")[0]}`);
    }
  };
  walk(sheet.cssRules, "");
  return out;
}

describe("allowedThemeCss", () => {
  it("keeps all of the theme skill's sample, comment first", () => {
    const css = allowedThemeCss(sample)!;
    expect(css.startsWith("/* Night Harbor - ")).toBe(true);
    expect(declarations(css)).toEqual(declarations(sample));
  });

  it("keeps the dark form under @media and a data: background", () => {
    const css = allowedThemeCss(
      `@media (prefers-color-scheme: dark) {
         :root[data-theme="dark"] { --doc-bg: #111; }
         :root[data-theme="dark"] #write h1 { color: #eee; }
       }
       .milkdown > #write blockquote { background-image: url("data:image/png;base64,AAAA"); }`,
    )!;
    expect(declarations(css)).toEqual([
      '@media (prefers-color-scheme: dark) :root[data-theme="dark"] --doc-bg',
      '@media (prefers-color-scheme: dark) :root[data-theme="dark"] #write h1 color',
      ".milkdown > #write blockquote background-image",
    ]);
  });

  it("drops rules for anything outside the document", () => {
    for (const selector of [
      ".sidebar",
      ".agent-panel button",
      "#write ~ .review-bar",
      "#write + div",
      "#writer p",
      "div #write",
      "*",
    ])
      expect(
        allowedThemeCss(`${selector} { color: red; }`),
        selector,
      ).toBeNull();
    // One bad selector in a list takes the rule with it.
    expect(allowedThemeCss("#write p, .menu { color: red; }")).toBeNull();
  });

  it("drops properties that change how the editor works or what it shows", () => {
    const css = allowedThemeCss(`#write h1::before {
      content: "Approved";
      display: block;
      position: fixed;
      pointer-events: none;
      user-select: none;
      caret-color: transparent;
      transform: scale(2);
      max-width: 10px;
      color: red;
    }`)!;
    expect(declarations(css)).toEqual(["#write h1::before color"]);
  });

  it("lets the root set variables and page colours only", () => {
    const css = allowedThemeCss(`:root {
      --doc-bg: #fff; --ui-text: #111; --tone-blue: #00f; --revision-insert-bg: #efe;
      --space-4: 99px; --shape-radius: 0; --tag: red;
      color: #111; font-size: 40px; display: none;
    }
    body { background-color: #fff; margin: 0; }`)!;
    expect(declarations(css)).toEqual([
      ":root --doc-bg",
      ":root --ui-text",
      ":root --tone-blue",
      ":root --revision-insert-bg",
      ":root color",
      "body background-color",
    ]);
  });

  it("drops at-rules a theme doesn't need", () => {
    expect(
      allowedThemeCss(
        `@font-face { font-family: X; src: url(data:font/woff2;base64,AA); }
         @keyframes spin { to { color: red; } }
         @page { margin: 0; }`,
      ),
    ).toBeNull();
  });
});
