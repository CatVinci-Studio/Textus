// A research paper's diagrams and charts drawn before a section is kept
// (src-tauri/src/ai/paper/figures.rs): a block that doesn't draw goes back
// to its writer with the renderer's words, so none reaches the paper as code.

import { diagramRenderer } from "../../editor/diagram-engine";
import type { FigureBlock } from "../../platform/bindings/ai-paper";

/** Drawn at about a page's text column. */
const WIDTH = 600;

let drawn = 0;

/** For each block, why it can't be drawn, or null. By Mermaid itself, not
 *  the user's engine: Pele falls back to Mermaid, and an export or another
 *  app draws with Mermaid, so what Mermaid draws is drawn everywhere. */
export async function figureErrors(
  blocks: readonly FigureBlock[],
): Promise<(string | null)[]> {
  // Mermaid's settings are global: left as the editor set them, so its own
  // diagrams keep their colours.
  const draw = diagramRenderer(
    "mermaid",
    { width: WIDTH, dark: false },
    () => {},
  );
  const errors: (string | null)[] = [];
  // One at a time: Mermaid lays out in the shared document.
  for (const block of blocks) {
    try {
      const { svg } = await draw(
        block.code,
        `paper-figure-check-${++drawn}`,
        block.language,
      );
      errors.push(svg.includes("<svg") ? null : "it drew nothing");
    } catch (err) {
      errors.push(String((err as Error)?.message ?? err) || "it drew nothing");
    }
  }
  return errors;
}
