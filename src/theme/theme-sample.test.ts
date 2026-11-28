import { describe, expect, it } from "vitest";
import { themeSample } from "./theme-sample";

const none = { bg: null, text: null, accent: null, font: null };

describe("themeSample", () => {
  it("reads the --doc-* variables of a Textus theme", () => {
    const css = `
      [data-content-theme="x"] { --doc-bg: #faf6ee; --doc-text: #2a2118;
        --doc-accent: #b4532a; --doc-font: "Iowan Old Style", serif; }`;
    expect(themeSample(css, false)).toEqual({
      bg: "#faf6ee",
      text: "#2a2118",
      accent: "#b4532a",
      font: '"Iowan Old Style", serif',
    });
  });

  it("reads a Typora theme's page, heading and link rules", () => {
    const css = `
      :root { --bg-color: #fff; --primary-color: #0a58ca; }
      #write { background: var(--bg-color); color: #333; font-family: Georgia; }
      #write h1 { font-family: "Playfair Display", serif; color: red; }
      #write a { color: var(--primary-color); }`;
    expect(themeSample(css, false)).toEqual({
      bg: "#fff",
      text: "#333",
      accent: "#0a58ca",
      font: '"Playfair Display", serif',
    });
  });

  it("takes the dark values in dark and ignores them in light", () => {
    const css = `
      :root { --doc-bg: #ffffff; --doc-text: #111111; }
      @media (prefers-color-scheme: dark) {
        :root:not([data-theme="light"]) { --doc-bg: #101010; --doc-text: #eeeeee; }
      }
      :root[data-theme="dark"] { --doc-bg: #101010; }`;
    expect(themeSample(css, true)).toMatchObject({
      bg: "#101010",
      text: "#eeeeee",
    });
    expect(themeSample(css, false)).toMatchObject({
      bg: "#ffffff",
      text: "#111111",
    });
  });

  it("leaves what a theme doesn't define null, for the current look", () => {
    expect(themeSample("#write h2 { margin: 0 }", false)).toEqual(none);
    expect(themeSample("", true)).toEqual(none);
  });

  it("never passes on a value that isn't a plain colour or font list", () => {
    const css = `:root { --doc-bg: url(x.png); --doc-text: var(--missing);
      --doc-accent: red; } #write h1 { font-family: a; } body { x: y }`;
    expect(themeSample(css, false)).toEqual({
      ...none,
      accent: "red",
      font: "a",
    });
  });

  it("is not thrown by comments, imports or font-face blocks", () => {
    const css = `@import url(a.css); /* :root { --doc-bg: #000 } */
      @font-face { font-family: F; src: url(f.woff2); }
      :root { --doc-bg: #123456 }`;
    expect(themeSample(css, false).bg).toBe("#123456");
  });
});
