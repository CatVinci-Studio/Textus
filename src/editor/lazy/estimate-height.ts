import type { Node as ProseNode } from "@milkdown/kit/prose/model";

// A placeholder's height before its block was ever drawn. It only has to be
// close: the block is measured once drawn, and the scroller's anchoring
// keeps what is on screen in place when an estimate above it turns out wrong.

/** The text column as the view measured it. */
export interface TextMetrics {
  /** Of body text, px. */
  lineHeight: number;
  /** How many CJK characters fit on a line (about the column's width over
   *  the font size); Latin letters count about half of one. */
  charsPerLine: number;
  /** Between two paragraphs, px. */
  blockGap: number;
}

/** Pictures and display formulas: about a short figure. */
const FIGURE_HEIGHT = 240;
const FIGURES = new Set(["image", "math_block"]);

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

/** A line's worth of `text` in CJK characters. */
function width(text: string): number {
  let units = 0;
  for (const char of text) units += WIDE.test(char) ? 1 : 0.55;
  return units;
}

function textblockLines(node: ProseNode, metrics: TextMetrics): number {
  if (node.type.spec.code) return node.textContent.split("\n").length;
  return Math.max(1, Math.ceil(width(node.textContent) / metrics.charsPerLine));
}

export function estimateHeight(node: ProseNode, metrics: TextMetrics): number {
  let height = 0;
  let figures = 0;
  const measure = (child: ProseNode) => {
    if (FIGURES.has(child.type.name)) {
      figures++;
      return false;
    }
    if (child.isTextblock) {
      const scale = child.type.name === "heading" ? 1.5 : 1;
      height +=
        textblockLines(child, metrics) * metrics.lineHeight * scale +
        metrics.blockGap;
      child.descendants((inline) => {
        if (FIGURES.has(inline.type.name)) figures++;
      });
      return false;
    }
    if (child.isAtom) {
      height += metrics.lineHeight + metrics.blockGap;
      return false;
    }
    return true;
  };
  if (measure(node)) node.descendants(measure);
  return Math.round(height + Math.min(figures, 4) * FIGURE_HEIGHT);
}
