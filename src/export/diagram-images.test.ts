// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { redrawDiagrams, replaceMermaidBlocks } from "./diagram-images";

const draw = async (code: string) =>
  code.includes("broken")
    ? null
    : { dataUrl: `data:x,${code.length}`, width: 640.4 };

describe("replaceMermaidBlocks", () => {
  it("turns each mermaid block into an image and keeps other code", async () => {
    const md = [
      "# T",
      "```mermaid",
      "graph LR",
      "  A --> B",
      "```",
      "```js",
      "const a = 1;",
      "```",
      "~~~mermaid",
      "broken",
      "~~~",
    ].join("\n");
    expect(await replaceMermaidBlocks(md, draw)).toBe(
      [
        "# T",
        "![](data:x,18){width=640px}",
        "```js",
        "const a = 1;",
        "```",
        "~~~mermaid",
        "broken",
        "~~~",
      ].join("\n"),
    );
  });

  it("leaves an unclosed block as source", async () => {
    const md = "```mermaid\ngraph LR";
    expect(await replaceMermaidBlocks(md, draw)).toBe(md);
  });

  it("keeps the source when drawing throws", async () => {
    const md = "```mermaid\ngraph LR\n```";
    expect(
      await replaceMermaidBlocks(md, () => Promise.reject(new Error("x"))),
    ).toBe(md);
  });
});

describe("redrawDiagrams", () => {
  // The serialized editor: a diagram's hidden source block, then its preview.
  const diagram = (code: string, svg: string) =>
    `<div class="code-block-wrapper mermaid-source-hidden"><pre><code>${code}</code></pre></div>` +
    `<div class="mermaid-preview">${svg}</div>`;

  it("draws each preview again from the source block before it", async () => {
    const html = await redrawDiagrams(
      diagram("graph LR", "<svg>dark</svg>") +
        diagram("broken", "<svg>kept</svg>"),
      async (code) => (code === "broken" ? null : `<svg>${code}</svg>`),
    );
    expect(html).toContain('<div class="mermaid-preview"><svg>graph LR</svg>');
    expect(html).toContain('<div class="mermaid-preview"><svg>kept</svg>');
    expect(html).not.toContain("dark");
  });

  it("keeps a picture Pele drew, whose colours follow the page through CSS", async () => {
    const draw = vi.fn(async () => "<svg>redrawn</svg>");
    const html = await redrawDiagrams(
      diagram("graph LR", '<svg class="pele pele-flowchart">p</svg>'),
      draw,
    );
    expect(html).toContain('<svg class="pele pele-flowchart">p</svg>');
    expect(draw).not.toHaveBeenCalled();
  });

  it("keeps the picture when drawing throws", async () => {
    const html = diagram("graph LR", "<svg>dark</svg>");
    expect(
      await redrawDiagrams(html, () => Promise.reject(new Error("x"))),
    ).toContain("<svg>dark</svg>");
  });
});
