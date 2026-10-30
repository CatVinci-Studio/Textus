import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isSelfContained, themeName, themesInReply } from "./chat-theme";

// What the theme skill produced for "a calm dark theme for night writing,
// teal accent, a serif", as a reply the chat offers "Use this theme" for.
const reply = readFileSync("src/theme/fixtures/theme-skill-reply.md", "utf8");
const skill = readFileSync("src-tauri/src/ai/skills/theme.md", "utf8");

const fence = (css: string) => "```css\n" + css + "\n```";

describe("themesInReply", () => {
  it("finds the theme in a skill reply, named from its first comment", () => {
    const [theme, ...rest] = themesInReply(reply);
    expect(rest).toEqual([]);
    expect(theme.name).toBe("Night Harbor");
    expect(theme.css).toContain("--editor-bg: #16191d;");
    expect(theme.css.startsWith("/* Night Harbor")).toBe(true);
  });

  it("offers each of a light and a dark version", () => {
    const text = [
      fence("/* Dune Light - sand */\n:root { --editor-bg: #fff; }"),
      "and",
      fence("/* Dune Dark - night */\n#write { color: #eee; }"),
    ].join("\n\n");
    expect(themesInReply(text).map((t) => t.name)).toEqual([
      "Dune Light",
      "Dune Dark",
    ]);
  });

  it("skips a block still streaming and CSS that isn't a theme", () => {
    expect(themesInReply("```css\n#write { color: red; }\n")).toEqual([]);
    expect(themesInReply(fence(".sidebar { color: red; }"))).toEqual([]);
    expect(themesInReply("```js\nconst write = '#write';\n```")).toEqual([]);
  });

  it("skips a theme that would load something from elsewhere", () => {
    for (const css of [
      '@import url("https://example.com/a.css");\n#write { color: red; }',
      "#write { background: url(https://example.com/x.png); }",
      "#write { background: \\75 rl(https://example.com/x.png); }",
      "@font-face { src: url(font.woff2); }\n#write { color: red; }",
    ])
      expect(themesInReply(fence(css))).toEqual([]);
  });
});

describe("isSelfContained", () => {
  it("allows data: images and fonts and comments that mention url()", () => {
    expect(
      isSelfContained(
        '/* no url(http://x) */ #write { background: url("data:image/png;base64,AAAA"); }',
      ),
    ).toBe(true);
  });
});

describe("themeName", () => {
  it("reads the name before the dash, or the whole first comment", () => {
    expect(themeName("/* Paper-Mint - fresh */")).toBe("Paper-Mint");
    expect(themeName("/* Plain */\n#write {}")).toBe("Plain");
    expect(themeName("#write {}")).toBeNull();
  });
});

describe("the theme skill and its sample", () => {
  // The variables the app reads.
  const variables = [
    "--editor-bg",
    "--editor-text",
    "--editor-muted",
    "--editor-accent",
    "--editor-border",
    "--editor-code-bg",
    "--editor-quote-border",
    "--editor-highlight-bg",
    "--editor-font",
    "--editor-list-gap",
    "--token-string",
    "--token-number",
    "--token-keyword",
    "--token-function",
    "--token-tag",
    "--doc-alert-note",
    "--doc-alert-tip",
    "--doc-alert-important",
    "--doc-alert-warning",
    "--doc-alert-caution",
  ];
  // Listed too, for a theme that wants them; not part of every theme.
  const revisionVariables = [
    "--revision-insert-bg",
    "--revision-insert-text",
    "--revision-insert-hover-bg",
    "--revision-reading-bg",
    "--revision-delete-bg",
    "--revision-delete-text",
    "--revision-delete-strike",
    "--revision-delete-hover-bg",
  ];

  it("lists every variable a theme sets, and only ones the app reads", () => {
    for (const name of [...variables, ...revisionVariables])
      expect(skill).toContain(`\`${name}\``);
    const appCss = [
      readFileSync("src/theme/content-base.css", "utf8"),
      readFileSync("src/ui/base.css", "utf8"),
      readFileSync("src/editor/milkdown-theme.css", "utf8"),
    ].join("\n");
    for (const [, name] of skill.matchAll(/`(--[a-z-]+)`/g))
      expect(appCss, name).toContain(`var(${name}`);
  });

  it("produced a complete, gallery-ready theme", () => {
    const [{ css }] = themesInReply(reply);
    for (const name of variables.filter((v) => v !== "--editor-list-gap"))
      expect(css).toContain(`${name}:`);
    expect(new TextEncoder().encode(css).length).toBeLessThan(200 * 1024);
    expect(css).not.toMatch(/!important|@import|font-synthesis/);
    expect(reply).toContain(
      "https://github.com/CatVinci-Studio/textus-themes/issues/1",
    );
  });
});
