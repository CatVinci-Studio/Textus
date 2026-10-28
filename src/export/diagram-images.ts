import { diagramRenderer, type MermaidApi } from "../editor/diagram-engine";
import type { DiagramEngine } from "../prefs/SettingsContext";

// Word, OpenDocument and EPUB don't know mermaid blocks, so each diagram is
// drawn as a PNG data URL before pandoc. One that can't be drawn keeps its
// source.

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;

/** The widest a diagram is placed, in CSS px: about a page's text column. */
const MAX_WIDTH = 600;

export interface DiagramImage {
  dataUrl: string;
  /** Width to place it at, in CSS px. */
  width: number;
}

/** Replaces each fenced block with what `draw` makes of its language
 *  (lowercased) and source; null or a throw keeps the block. */
export async function replaceFencedBlocks(
  markdown: string,
  draw: (language: string, code: string) => Promise<DiagramImage | null>,
): Promise<string> {
  const lines = markdown.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE.exec(lines[i]);
    if (!open) {
      out.push(lines[i]);
      continue;
    }
    const fence = open[1];
    let end = i + 1;
    while (end < lines.length) {
      const close = FENCE.exec(lines[end]);
      if (
        close &&
        !close[2] &&
        close[1][0] === fence[0] &&
        close[1].length >= fence.length
      )
        break;
      end++;
    }
    const block = lines.slice(i, Math.min(end + 1, lines.length));
    i = end;
    if (end >= lines.length) {
      out.push(...block);
      continue;
    }
    const image = await draw(
      open[2].toLowerCase(),
      block.slice(1, -1).join("\n"),
    ).catch(() => null);
    if (image) {
      out.push(`![](${image.dataUrl}){width=${Math.round(image.width)}px}`);
    } else {
      out.push(...block);
    }
  }
  return out.join("\n");
}

/** Draws an SVG onto a white canvas at twice its size. Throws when the SVG
 *  can't be drawn (e.g. HTML labels in a foreignObject taint the canvas). */
async function svgToPng(svg: string): Promise<DiagramImage> {
  const root = new DOMParser()
    .parseFromString(svg, "image/svg+xml")
    .querySelector("svg");
  if (!root) throw new Error("not an SVG");
  const box = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const width = box[2] || parseFloat(root.getAttribute("width") ?? "") || 600;
  const height = box[3] || parseFloat(root.getAttribute("height") ?? "") || 400;
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  root.style.removeProperty("max-width");
  const image = new Image();
  image.src =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(new XMLSerializer().serializeToString(root));
  await image.decode();
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: Math.min(width, MAX_WIDTH),
  };
}

let exportId = 0;

/** The markdown with its diagrams as pictures, for a pandoc export, drawn
 *  by `engine` and by Mermaid where it can't. */
export async function diagramsToImages(
  markdown: string,
  engine: DiagramEngine,
): Promise<string> {
  if (!/^ {0,3}(`{3,}|~{3,})\s*mermaid/im.test(markdown)) return markdown;
  const fontFamily = getComputedStyle(document.body).fontFamily;
  // A page is white, and labels must be SVG text (not HTML) to draw on a
  // canvas. The editor re-applies its own settings before its next render.
  const configure = (mermaid: MermaidApi) =>
    mermaid.initialize({
      startOnLoad: false,
      theme: "neutral",
      securityLevel: "strict",
      suppressErrorRendering: true,
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      // At the page's width: shrunk from 1200px, Gantt labels are unreadable.
      gantt: {
        useWidth: MAX_WIDTH,
        fontSize: 13,
        sectionFontSize: 13,
        barHeight: 22,
        barGap: 6,
        axisFormat: "%m-%d",
      },
      fontFamily,
    });
  const draw = diagramRenderer(
    engine,
    { width: MAX_WIDTH, fontFamily, dark: false },
    configure,
  );
  return replaceFencedBlocks(markdown, async (language, code) =>
    language === "mermaid"
      ? svgToPng((await draw(code, `export-diagram-${++exportId}`)).svg)
      : null,
  );
}

/** A drawn block's picture as a PNG pandoc can embed, no wider than a
 *  page's text. */
async function pictureToImage(url: string): Promise<DiagramImage> {
  if (url.startsWith("data:image/svg+xml"))
    return svgToPng(decodeURIComponent(url.slice(url.indexOf(",") + 1)));
  const image = new Image();
  image.src = url;
  await image.decode();
  return { dataUrl: url, width: Math.min(image.naturalWidth / 2, MAX_WIDTH) };
}

/** The markdown with each plugin-drawn block as its picture, by language in
 *  document order; one with no picture keeps its source. */
export async function drawnBlocksToImages(
  markdown: string,
  pictures: Map<string, (string | null)[]>,
): Promise<string> {
  if (!pictures.size) return markdown;
  const seen = new Map<string, number>();
  return replaceFencedBlocks(markdown, async (language) => {
    const list = pictures.get(language);
    if (!list) return null;
    const n = seen.get(language) ?? 0;
    seen.set(language, n + 1);
    const url = list[n];
    return url ? pictureToImage(url) : null;
  });
}

/** Replaces the SVG of every rendered diagram in editor `html` with what
 *  `draw` makes of its source. Pele's are kept: their CSS-variable colours
 *  adapt to a light page. */
export async function redrawDiagrams(
  html: string,
  draw: (code: string) => Promise<string | null>,
): Promise<string> {
  const template = document.createElement("template");
  template.innerHTML = html;
  const previews = Array.from(
    template.content.querySelectorAll<HTMLElement>(".mermaid-preview"),
  );
  for (const preview of previews) {
    const source = preview.previousElementSibling;
    if (!source?.classList.contains("mermaid-source-hidden")) continue;
    if (preview.querySelector(":scope > svg.pele")) continue;
    const code = (source.querySelector("code") ?? source).textContent ?? "";
    const svg = await draw(code).catch(() => null);
    if (svg) preview.innerHTML = svg;
  }
  return template.innerHTML;
}

/** The editor's Mermaid diagrams redrawn in mermaid's light style for a PDF
 *  on white, where dark-theme lines vanish. Pele's are left as they are. */
export async function lightDiagrams(
  html: string,
  width: number,
  fontFamily: string,
): Promise<string> {
  if (!html.includes("mermaid-preview")) return html;
  const draw = diagramRenderer("mermaid", { width, fontFamily, dark: false });
  return redrawDiagrams(
    html,
    async (code) => (await draw(code, `export-diagram-${++exportId}`)).svg,
  );
}
