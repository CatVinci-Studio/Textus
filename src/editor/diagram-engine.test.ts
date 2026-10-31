// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const pele = vi.hoisted(() => ({
  renderAsync: vi.fn(),
}));
const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));
vi.mock("pele/lazy", () => pele);
vi.mock("mermaid", () => ({ default: mermaid }));

import {
  diagramRenderer,
  peleMayDraw,
  resetPeleRefusals,
} from "./diagram-engine";
import { normaliseSettings } from "../prefs/SettingsContext";

const FLOW = "flowchart LR\n  A --> B";

beforeEach(() => {
  vi.clearAllMocks();
  resetPeleRefusals();
  pele.renderAsync.mockResolvedValue({ svg: '<svg class="pele">p</svg>' });
  mermaid.render.mockResolvedValue({ svg: '<svg id="m">m</svg>' });
});

describe("diagramRenderer", () => {
  it("draws with Mermaid and never loads Pele when Mermaid is the engine", async () => {
    const draw = diagramRenderer("mermaid", { width: 600 });
    expect(await draw(FLOW, "d1")).toEqual({
      svg: '<svg id="m">m</svg>',
      engine: "mermaid",
    });
    expect(pele.renderAsync).not.toHaveBeenCalled();
  });

  it("draws with Pele without touching Mermaid when Pele is the engine", async () => {
    const draw = diagramRenderer("pele", { width: 600, fontFamily: "Serif" });
    expect(await draw(FLOW, "d1")).toEqual({
      svg: '<svg class="pele">p</svg>',
      engine: "pele",
    });
    expect(mermaid.initialize).not.toHaveBeenCalled();
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it("gives Pele the document's link and image schemes and the source's direction", async () => {
    await diagramRenderer("pele", { width: 600, fontFamily: "Serif" })(
      FLOW,
      "d1",
    );
    expect(pele.renderAsync).toHaveBeenCalledWith(FLOW, {
      maxWidth: 600,
      autoDirection: false,
      fontFamily: "Serif",
      linkSchemes: ["http", "https", "mailto"],
      imageSchemes: ["http", "https"],
    });
  });

  it("lets through only the links the rest of the document may carry", async () => {
    await diagramRenderer("pele", { width: 600 })(FLOW, "d1");
    const options = pele.renderAsync.mock.calls[0][1];
    const real = await vi.importActual<typeof import("pele")>("pele");
    const { svg } = real.render(
      [
        "flowchart LR",
        "  A --> B --> C --> D --> E",
        '  click A "javascript:alert(1)"',
        '  click B "tel:123"',
        '  click C "file:///etc/passwd"',
        '  click D "https://example.com/"',
        '  click E "mailto:a@example.com"',
      ].join("\n"),
      // jsdom has no canvas to measure text with.
      { ...options, measurer: { width: (text: string) => text.length * 8 } },
    );
    const hrefs = [...svg.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["https://example.com/", "mailto:a@example.com"]);
    expect(svg).not.toMatch(/javascript:|<script|\son[a-z]+=/i);
  });

  it("falls back to Mermaid when Pele throws, and doesn't ask Pele again for that source", async () => {
    pele.renderAsync.mockRejectedValue(new Error("syntax"));
    const first = diagramRenderer("pele", { width: 600 });
    expect((await first(FLOW, "d1")).engine).toBe("mermaid");
    const next = diagramRenderer("pele", { width: 600 });
    expect((await next(FLOW, "d2")).engine).toBe("mermaid");
    expect(pele.renderAsync).toHaveBeenCalledTimes(1);
    expect(mermaid.render).toHaveBeenCalledTimes(2);
  });

  it("still asks Pele for other sources after one fell back", async () => {
    pele.renderAsync.mockRejectedValueOnce(new Error("syntax"));
    const draw = diagramRenderer("pele", { width: 600 });
    await draw(FLOW, "d1");
    expect((await draw("flowchart TB\n  X --> Y", "d2")).engine).toBe("pele");
  });

  it("falls back to Mermaid when Pele draws nothing", async () => {
    pele.renderAsync.mockResolvedValue({ svg: "" });
    expect(
      (await diagramRenderer("pele", { width: 600 })(FLOW, "d1")).engine,
    ).toBe("mermaid");
  });

  it("draws a chart with its own renderer, touching neither engine", async () => {
    const draw = diagramRenderer("pele", { width: 600 });
    const { svg, engine } = await draw('{"data": [1, 2]}', "d1", "chart");
    expect(engine).toBe("chart");
    expect(svg).toContain('class="textus-chart"');
    expect(pele.renderAsync).not.toHaveBeenCalled();
    expect(mermaid.render).not.toHaveBeenCalled();
    await expect(draw("{oops", "d2", "chart")).rejects.toThrow(
      "not valid JSON",
    );
  });

  it("throws when neither engine can draw the source", async () => {
    pele.renderAsync.mockRejectedValue(new Error("syntax"));
    mermaid.render.mockRejectedValue(new Error("syntax"));
    await expect(
      diagramRenderer("pele", { width: 600 })("flowchart LR\n  A -->", "d1"),
    ).rejects.toThrow("syntax");
  });

  it("sets Mermaid up once per pass, in the pass's palette", async () => {
    const draw = diagramRenderer("mermaid", { width: 500, dark: true });
    await draw(FLOW, "d1");
    await draw("flowchart TB\n  X --> Y", "d2");
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    expect(mermaid.initialize.mock.calls[0][0]).toMatchObject({
      theme: "dark",
      securityLevel: "strict",
    });
  });
});

describe("peleMayDraw", () => {
  it("leaves HTML labels to Mermaid", () => {
    expect(peleMayDraw("flowchart LR\n  A[\"<span style='x'>a</span>\"]")).toBe(
      false,
    );
    expect(peleMayDraw("flowchart LR\n  A[\"<img src='a.png'>\"]")).toBe(false);
  });

  it("draws the line breaks and bold or italic tags Pele supports", () => {
    expect(peleMayDraw('flowchart LR\n  A["one<br/>two <b>bold</b>"]')).toBe(
      true,
    );
  });

  it("reads a class annotation as no tag", () => {
    expect(peleMayDraw("classDiagram\n  class A\n  <<interface>> A")).toBe(
      true,
    );
  });

  it("leaves colours set through Mermaid's themeVariables to Mermaid", () => {
    expect(
      peleMayDraw(
        "%%{init: {'themeVariables': {'primaryColor': '#f00'}}}%%\n" + FLOW,
      ),
    ).toBe(false);
  });
});

describe("Settings.diagramEngine", () => {
  it("is Mermaid unless Pele was chosen", () => {
    expect(normaliseSettings(null).diagramEngine).toBe("mermaid");
    expect(normaliseSettings({ theme: "dark" }).diagramEngine).toBe("mermaid");
    expect(normaliseSettings({ diagramEngine: "pele" }).diagramEngine).toBe(
      "pele",
    );
    expect(normaliseSettings({ diagramEngine: "dagre" }).diagramEngine).toBe(
      "mermaid",
    );
  });
});
