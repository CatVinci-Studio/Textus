import { describe, expect, it } from "vitest";
import { colorOfCode, findColorCodes, OPAQUE } from "./color-codes";

describe("colorOfCode", () => {
  it("takes hex and colour functions", () => {
    for (const code of [
      "#fff",
      "#FFFA",
      "#ff8800",
      "#ff880080",
      "rgb(0, 128, 255)",
      "rgba(0,128,255,.5)",
      "rgb(0 128 255)",
      "rgb(0 128 255 / 50%)",
      "rgb(10%, 20%, 30%)",
      "hsl(120, 50%, 50%)",
      "hsla(120deg, 50%, 50%, 0.3)",
      "hsl(0.5turn 50% 50% / .5)",
      "oklch(70% 0.1 120)",
      "oklch(0.7 0.15 30deg / 50%)",
      "oklab(0.7 -0.1 0.1)",
      "color(display-p3 1 0.5 0)",
      "color(srgb 0.2 0.4 0.6 / .5)",
      " #fff ",
    ])
      expect(colorOfCode(code), code).toBe(code.trim());
  });

  it("leaves colour names, broken codes and other text alone", () => {
    for (const code of [
      "red",
      "currentColor",
      "transparent",
      "#ff",
      "#fffff",
      "#ggg",
      "rgb(0, 128)",
      "rgb(0, 128, 255",
      "rgb(a, b, c)",
      "hsl(120, 50, 50)",
      "rgb(0 128 255); background: red",
      "oklch(70% 0.1)",
      "color(cmyk 1 0 0)",
      "url(x)",
      "color: #fff",
      "#fff #000",
      "",
    ])
      expect(colorOfCode(code), code).toBeNull();
  });
});

/** The codes findColorCodes reads in `text`, as written. */
const codes = (text: string) =>
  findColorCodes(text).map(({ from, to }) => text.slice(from, to));

describe("findColorCodes", () => {
  it("finds hex codes standing as tokens of their own", () => {
    expect(codes("Orange #ff8800 and #FF880080.")).toEqual([
      "#ff8800",
      "#FF880080",
    ]);
    expect(codes("#f00")).toEqual(["#f00"]);
    expect(codes("(#0af), [#09c] and '#1e1e1e'")).toEqual([
      "#0af",
      "#09c",
      "#1e1e1e",
    ]);
    expect(codes("a #ffffff, b #abcdef; c #c0ffee!")).toEqual([
      "#ffffff",
      "#abcdef",
      "#c0ffee",
    ]);
    expect(codes("color:#ff8800")).toEqual(["#ff8800"]);
    expect(codes("#ff8800\n#00ff00")).toEqual(["#ff8800", "#00ff00"]);
  });

  it("finds a hex code right beside CJK text, which has no spaces", () => {
    expect(codes("主色是#ff8800，辅色#0af。")).toEqual(["#ff8800", "#0af"]);
    expect(codes("「#1e90ff」の色")).toEqual(["#1e90ff"]);
  });

  it("leaves tags spelled in hex letters alone", () => {
    for (const text of [
      "#add",
      "#bad",
      "#fed",
      "#cafe",
      "#beef",
      "#face",
      "#fade #dead #deaf #abba",
      "a #tag and #ace",
      "#facade",
      "#decade work",
      "#fff",
      "#FFFF",
    ])
      expect(codes(text), text).toEqual([]);
  });

  it("leaves issue numbers and other numbers alone", () => {
    for (const text of [
      "#234",
      "Fixes #1234.",
      "see #146 and #12",
      "item #1",
      "C# 10",
      "#2024",
    ])
      expect(codes(text), text).toEqual([]);
  });

  it("leaves hex inside words, tags, paths and URLs alone", () => {
    for (const text of [
      "#ff8800ff00",
      "#ff88001",
      "#fff#000",
      "##ff8800",
      "#ff8800-dark",
      "#ff8800_x",
      "abc#ff8800",
      "x.com#ff8800",
      "https://example.com/#ff8800",
      "https://example.com/page#ff8800",
      "https://example.com/?c=#ff8800",
      "(https://example.com/#ff8800)",
      "www.example.com/x(#ff8800)",
      "path/#a1b2c3",
      "C:\\#a1b2c3",
      "a&#x20;",
      "&#123;",
      "[^#ff8800]",
      "@#ff8800",
      "#ff8800.png",
      "#ff8800:hover",
      "#ab12cd/foo",
      "#tag/#ff8800",
      "#ff8800é",
      "é#ff8800",
      "1#ff8800",
    ])
      expect(codes(text), text).toEqual([]);
  });

  it("never reads a code across text that isn't the block's own", () => {
    expect(codes(`${OPAQUE}#ff8800`)).toEqual(["#ff8800"]);
    expect(codes(`#ff${OPAQUE}8800`)).toEqual([]);
  });

  it("finds colour functions wherever they are whole", () => {
    expect(
      codes(
        "Blue rgb(0 128 255), see-through rgba(0,0,0,.5) and hsl(120 50% 50%).",
      ),
    ).toEqual(["rgb(0 128 255)", "rgba(0,0,0,.5)", "hsl(120 50% 50%)"]);
    expect(
      codes(
        "oklch(70% 0.1 120) / oklab(0.7 -0.1 0.1) / color(display-p3 1 0 0)",
      ),
    ).toEqual([
      "oklch(70% 0.1 120)",
      "oklab(0.7 -0.1 0.1)",
      "color(display-p3 1 0 0)",
    ]);
    expect(codes("color:rgb(1 2 3);")).toEqual(["rgb(1 2 3)"]);
    expect(codes("颜色rgb(1 2 3)")).toEqual(["rgb(1 2 3)"]);
  });

  it("leaves broken colour functions and lookalikes alone", () => {
    for (const text of [
      "rgb(0, 128)",
      "rgb(0 128 255",
      "rgb(a, b, c)",
      "rgb()",
      "hsl(120, 50, 50)",
      "xrgb(1 2 3)",
      "my-rgb(1 2 3)",
      "a.rgb(1 2 3)",
      "https://example.com/rgb(1,2,3)",
      "color(cmyk 1 0 0)",
      "oklch(70%)",
      "var(--accent)",
    ])
      expect(codes(text), text).toEqual([]);
  });

  it("leaves colour names alone", () => {
    expect(codes("red, blue, rebeccapurple and transparent")).toEqual([]);
  });

  it("gives the colour each code names", () => {
    expect(findColorCodes("a #ff8800 b")).toEqual([
      { from: 2, to: 9, color: "#ff8800" },
    ]);
  });
});
