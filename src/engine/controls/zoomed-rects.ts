/**
 * Boxes read inside the document's zoom (`--content-zoom`, CSS `zoom` on the
 * text) as drawn on screen. Chromium and current WebKit report them as
 * drawn; the WebKit in macOS's and iOS's web view reports them as laid out
 * before the zoom, measured from the viewport's corner, so they are scaled
 * by it. Which one this engine does is read off `inside` itself.
 */
export function zoomedRectScale(inside: HTMLElement): number {
  const zoom =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--content-zoom",
      ),
    ) || 1;
  if (Math.abs(zoom - 1) < 0.01) return 1;
  const drawn = inside.getBoundingClientRect().width;
  const laid = inside.offsetWidth;
  if (!drawn || !laid) return 1;
  return Math.abs(drawn - laid) < Math.abs(drawn - laid * zoom) ? zoom : 1;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** `box`, read inside the zoom, as drawn: scaled by `scale` from
 *  zoomedRectScale. */
export function asDrawn(box: Box, scale: number): Box {
  if (scale === 1) return box;
  return {
    left: box.left * scale,
    top: box.top * scale,
    right: box.right * scale,
    bottom: box.bottom * scale,
  };
}
