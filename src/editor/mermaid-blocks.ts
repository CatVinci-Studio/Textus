import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { PluginKey } from "@milkdown/kit/prose/state";
import { DIAGRAM_LANGUAGES } from "./diagram-languages";
import type { DrawnDiagram } from "./diagram-engine";

/** The mermaid preview plugin's key. Its transactions carry what to draw:
 *  "rerender" for a finished render, "reveal" for a click that put the caret
 *  in a source block. Here so the widget can say it without a cycle through
 *  the plugin. */
export const mermaidKey = new PluginKey("mermaid-preview");

/** The smallest a strip diagram is scaled down to fit the column; one wider
 *  than that keeps this scale and scrolls, so a long timeline stays readable. */
const MIN_SCALE = 0.65;

/** The diagrams laid out as one long strip (a timeline, a Gantt chart):
 *  their type keyword leads the source, with nothing before it but `%%`
 *  comment lines. Their SVG carries no class to tell them by. */
const STRIP = /^(gantt|timeline)(\s|$)/;

function isStrip(source: string): boolean {
  for (const line of source.split("\n")) {
    const head = line.trim();
    if (!head || head.startsWith("%%")) continue;
    return STRIP.test(head);
  }
  return false;
}

/** `container`'s drawing given the least width it can be read at, from its
 *  viewBox. A strip keeps this scale and scrolls; anything else — an ER's
 *  entities, a flowchart's nodes — is a closed layout that must be seen
 *  whole, so it fits the column and its zoom button shows it large. One
 *  laid out for the column, as a chart is, is never held. */
export function keepReadable(container: HTMLElement, source = "") {
  if (!isStrip(source)) return;
  const svg = container.querySelector("svg");
  const width = svg?.viewBox?.baseVal?.width;
  if (!svg || !width) return;
  svg.style.minWidth = `${Math.round(width * MIN_SCALE)}px`;
}

/** A diagram as the preview last drew it. */
export interface Drawn {
  svg: string;
  engine: DrawnDiagram["engine"];
  /** What it was drawn for (the render pass's `styleOf`). */
  style: string;
  /** Part of its widget's key: with the source alone, ProseMirror kept the old
   *  widget DOM after a theme switch. */
  id: number;
}

interface MermaidBlock {
  from: number;
  to: number;
  code: string;
  language: string;
  /** What its drawing is kept under. */
  key: string;
}

export const isCodeBlock = (node: ProseNode) => node.type.name === "code_block";
export const isMermaid = (node: ProseNode) =>
  isCodeBlock(node) && DIAGRAM_LANGUAGES.includes(node.attrs.language);

/** A drawing's cache key: its source, and a chart's language with it, so a
 *  chart and a diagram of the same text never share a drawing. */
export const drawingKey = (language: string, code: string) =>
  language === "mermaid" ? code : `${language}\n${code}`;

export function collectMermaidBlocks(doc: ProseNode): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  doc.descendants((node, pos) => {
    // A paragraph's or heading's inline nodes never hold a diagram.
    if (node.isTextblock && !isCodeBlock(node)) return false;
    if (isMermaid(node)) {
      const language = node.attrs.language as string;
      blocks.push({
        from: pos,
        to: pos + node.nodeSize,
        code: node.textContent,
        language,
        key: drawingKey(language, node.textContent),
      });
    }
  });
  return blocks;
}
