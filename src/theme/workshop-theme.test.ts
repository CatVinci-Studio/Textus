import { describe, expect, it } from "vitest";
import { NO_CHOICES } from "./theme-typography";
import {
  chromeDeclarations,
  readWorkshopTheme,
  workshopThemeCss,
} from "./workshop-theme";

const BASE = {
  light: ":root { --doc-bg: #fff; }\n",
  dark: ":root { --doc-bg: #000; }\n",
};

describe("workshopThemeCss", () => {
  it("names the theme and adds the typography after each file", () => {
    const theme = workshopThemeCss({
      name: "Quiet */ Paper",
      base: BASE,
      choices: { ...NO_CHOICES, lineHeight: 2 },
    });
    expect(theme.light.startsWith("/* Quiet  Paper - made in the")).toBe(true);
    expect(theme.light).toMatch(/--doc-bg: #fff;[\s\S]*--doc-line-height: 2;/);
    expect(theme.dark).toMatch(/--doc-bg: #000;[\s\S]*--doc-line-height: 2;/);
  });

  it("keeps a one-file theme one file", () => {
    const theme = workshopThemeCss({
      name: "Mine",
      base: { light: "body { color: red; }", dark: null },
      choices: NO_CHOICES,
    });
    expect(theme.dark).toBeNull();
    expect(theme.light).toContain("body { color: red; }");
  });

  it("writes each appearance's palette, and holds the window's colours", () => {
    const theme = workshopThemeCss(
      {
        name: "Moss",
        base: BASE,
        choices: { ...NO_CHOICES, palette: "moss", syntax: "harbor" },
      },
      undefined,
      {
        light:
          ":root { --doc-bg: #fff !important;\n--ui-bg: #fafafa !important;\n--ui-text: #111 !important; }",
        dark: ":root { --ui-bg: #101010 !important; }",
      },
    );
    expect(theme.light).toContain("--doc-bg: #f5f7f1;");
    expect(theme.light).toContain("--doc-token-keyword: #1d5fa8;");
    expect(theme.light).toContain("--ui-bg: #fafafa;");
    expect(theme.light).not.toContain("--doc-bg: #fff !important");
    expect(theme.dark).toContain("--doc-bg: #151a13;");
    expect(theme.dark).toContain("--ui-bg: #101010;");
  });

  it("writes no colours, nor window pins, with no palette picked", () => {
    const theme = workshopThemeCss(
      { name: "Plain", base: BASE, choices: { ...NO_CHOICES, syntax: "neon" } },
      undefined,
      { light: ":root { --ui-bg: #fafafa !important; }", dark: null },
    );
    expect(theme.light).toContain("--doc-token-string: #0d7a52;");
    expect(theme.light).not.toContain("--ui-bg");
  });
});

describe("readWorkshopTheme", () => {
  it("gives back the starting theme and the choices as left", () => {
    const choices = {
      ...NO_CHOICES,
      bodyFont: "Georgia",
      fontSize: 18,
      palette: "dusk",
    };
    const css = workshopThemeCss({ name: "Mine", base: BASE, choices });
    const read = readWorkshopTheme(css, "Mine");
    expect(read).toEqual({ name: "Mine", base: BASE, choices });
    // Made again from what was read, it is the same file.
    expect(workshopThemeCss(read!)).toEqual(css);
  });

  it("reads choices an older workshop didn't have as the theme's own", () => {
    const css = workshopThemeCss({
      name: "Old",
      base: BASE,
      choices: NO_CHOICES,
    });
    const older = css.light.replace(',"palette":"","syntax":""', "");
    expect(
      readWorkshopTheme({ light: older, dark: null }, "Old")?.choices,
    ).toEqual(NO_CHOICES);
  });

  it("carries the faces served from files below the mark, made afresh", () => {
    const face = '@font-face { font-family: "Inter"; src: url("x"); }';
    const css = workshopThemeCss(
      {
        name: "Mine",
        base: BASE,
        choices: { ...NO_CHOICES, bodyFont: "Inter" },
      },
      undefined,
      undefined,
      face,
    );
    expect(css.light).toContain(face);
    expect(css.dark).toContain(face);
    expect(readWorkshopTheme(css, "Mine")?.base).toEqual(BASE);
  });

  it("reads a hand-edited choice that doesn't fit as the theme's own", () => {
    const css = workshopThemeCss({
      name: "Mine",
      base: BASE,
      choices: NO_CHOICES,
    });
    const edited = css.light.replace(
      /\{"bodyFont".*\} \*\//,
      '{"bodyFont":7,"codeFont":" Menlo ","fontSize":999,"lineHeight":"2",' +
        '"width":null,"indent":-3,"palette":"nope","syntax":"neon"} */',
    );
    expect(
      readWorkshopTheme({ light: edited, dark: null }, "Mine")?.choices,
    ).toEqual({
      ...NO_CHOICES,
      codeFont: "Menlo",
      fontSize: 26,
      indent: 0,
      syntax: "neon",
    });
  });

  it("is null for a theme the workshop didn't make", () => {
    expect(readWorkshopTheme(BASE, "Theirs")).toBeNull();
  });
});

describe("chromeDeclarations", () => {
  it("keeps the window's colours, not the document's or the column's", () => {
    expect(
      chromeDeclarations(
        ":root { --ui-bg: #fff !important;\n--doc-bg: #eee !important;\n--theme-text-width: 640px !important;\ncolor-scheme: light !important; }",
      ),
    ).toEqual(["--ui-bg: #fff"]);
  });
});
