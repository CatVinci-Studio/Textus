import { beforeEach, describe, expect, it, vi } from "vitest";
import { webAssets } from "../platform/ipc";
import { withWebFonts } from "./web-fonts";

vi.mock("../platform/ipc", () => ({ webAssets: { get: vi.fn() } }));
const get = vi.mocked(webAssets.get);

const GOOGLE = "https://fonts.googleapis.com/css2?family=Inter";
const SHEET = `@font-face { font-family: "Inter"; src: url(https://fonts.gstatic.com/s/inter.woff2) format("woff2"); }`;

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (url, kind) => {
    if (kind === "stylesheet" && url === GOOGLE) return SHEET;
    if (kind === "font" && url.endsWith(".woff2"))
      return "data:font/woff2;base64,AAAA";
    throw new Error("not found");
  });
});

describe("withWebFonts", () => {
  it("puts a web stylesheet's text in place of its @import, its fonts embedded", async () => {
    const css = await withWebFonts(
      `@import url("${GOOGLE}");\nbody { font-family: Inter; }`,
    );
    expect(css).not.toContain("@import");
    expect(css).toContain('url("data:font/woff2;base64,AAAA")');
    expect(css).toContain("body { font-family: Inter; }");
  });

  it("embeds a @font-face's web font, and leaves other web addresses alone", async () => {
    const css = await withWebFonts(
      `@font-face { font-family: X; src: url('//fonts.example.com/x.woff2'); }\nh1 { background: url(https://example.com/a.png); }`,
    );
    expect(css).toContain('url("data:font/woff2;base64,AAAA")');
    expect(css).toContain("url(https://example.com/a.png)");
    expect(get).toHaveBeenCalledWith(
      "https://fonts.example.com/x.woff2",
      "font",
    );
  });

  it("keeps an @import's media condition, and what can't be fetched as written", async () => {
    const css = await withWebFonts(
      `@import "${GOOGLE}" screen;\n@import url(https://gone.example.com/a.css);`,
    );
    expect(css).toMatch(/@media screen \{[\s\S]*data:font\/woff2/);
    expect(css).toContain("@import url(https://gone.example.com/a.css);");
  });

  it("fetches nothing for CSS without web addresses", async () => {
    const plain = "h1 { color: red; }";
    expect(await withWebFonts(plain)).toBe(plain);
    expect(get).not.toHaveBeenCalled();
  });
});
