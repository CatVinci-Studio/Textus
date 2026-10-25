/**
 * The code blocks plugins draw in the document (textus.views.registerCode
 * Block): which plugin draws a language, and - for each block shown - the
 * way to change its source in the editor. The editor's node view
 * (editor/code/plugin-code-block.ts) fills this in as blocks come into
 * sight and go.
 */

/** A drawn block's way back into the document. */
export interface DrawnCodeBlock {
  plugin: string;
  /** Replaces the block's source, as one undo step; false when the block
   *  is gone. */
  setSource(source: string): boolean;
}

const drawn = new Map<string, DrawnCodeBlock>();

export function trackCodeBlock(webview: string, block: DrawnCodeBlock): void {
  drawn.set(webview, block);
}

export function untrackCodeBlock(webview: string): void {
  drawn.delete(webview);
}

/** textus CodeBlock.setSource. */
export function setCodeBlockSource(webview: string, source: string): boolean {
  return drawn.get(webview)?.setSource(source) ?? false;
}
