import { afterEach, describe, expect, it, vi } from "vitest";

// Vitest reads stylesheets as empty: one face, as KaTeX writes them.
vi.mock("katex/dist/katex.min.css?raw", () => ({
  default:
    '@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2"),url(fonts/KaTeX_Main-Regular.woff) format("woff"),url(fonts/KaTeX_Main-Regular.ttf) format("truetype")}',
}));

describe("katexInlineCss", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("puts every face's woff2 inside the stylesheet, loading nothing", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetch);
    const { katexInlineCss } = await import("./katex-inline-css");
    const css = await katexInlineCss();
    expect(css).toContain(
      'src:url(data:font/woff2;base64,AQID) format("woff2")',
    );
    expect(css).not.toMatch(/url\(fonts\//);
    expect(fetch.mock.calls.length).toBeGreaterThan(10);
  });
});
