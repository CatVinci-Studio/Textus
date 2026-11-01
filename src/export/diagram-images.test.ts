// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { redrawDiagrams, replaceFencedBlocks } from "./diagram-images";

const draw = async (language: string, code: string) =>
  language !== "mermaid" || code.includes("broken")
    ? null
    : { dataUrl: `data:x,${code.length}`, width: 640.4 };

describe("replaceFencedBlocks", () => {
  it("turns the blocks drawn into images and keeps the rest", async () => {
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
    expect(await replaceFencedBlocks(md, draw)).toBe(
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
    expect(await replaceFencedBlocks(md, draw)).toBe(md);
  });

  it("keeps the source when drawing throws", async () => {
    const md = "```mermaid\ngraph LR\n```";
    expect(
      await replaceFencedBlocks(md, () => Promise.reject(new Error("x"))),
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

  it("redraws a chart as a chart", async () => {
    const draw = vi.fn(async () => "<svg>light</svg>");
    await redrawDiagrams(
      diagram('{"data": [1]}', '<svg class="textus-chart">dark</svg>') +
        diagram("graph LR", "<svg>dark</svg>"),
      draw,
    );
    expect(draw.mock.calls).toEqual([
      ['{"data": [1]}', "chart"],
      ["graph LR", "mermaid"],
    ]);
  });

  it("keeps the picture when drawing throws", async () => {
    const html = diagram("graph LR", "<svg>dark</svg>");
    expect(
      await redrawDiagrams(html, () => Promise.reject(new Error("x"))),
    ).toContain("<svg>dark</svg>");
  });
});
