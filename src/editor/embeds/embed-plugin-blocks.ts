/**
 * Plugins' blocks in an embedded note, drawn by whoever knows the plugins
 * (document-view sets it): the embed only hands over its body.
 */
type Drawer = (body: HTMLElement, path: string, signal: AbortSignal) => void;

let drawer: Drawer | null = null;

export function setEmbeddedBlocks(draw: Drawer): void {
  drawer = draw;
}

export function drawEmbeddedBlocks(
  body: HTMLElement,
  path: string,
  signal: AbortSignal,
): void {
  drawer?.(body, path, signal);
}
