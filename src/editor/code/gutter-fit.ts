/**
 * A code block's line numbers beside lines that wrap (#353): each number
 * as tall as its line, which may run onto several rows of the block. The
 * line's top is its first character's - a newline for an empty line - so
 * the text is measured as drawn, highlighting spans and all.
 */

/** Sets each number's height in `gutter` from the lines of `code`. */
export function fitGutter(gutter: HTMLElement, code: HTMLElement): void {
  const numbers = Array.from(gutter.children) as HTMLElement[];
  if (!numbers.length) return;
  const tops = lineTops(code);
  const box = code.getBoundingClientRect();
  if (!tops.length || !box.height) {
    for (const number of numbers) number.style.removeProperty("height");
    return;
  }
  // Measured on screen, set in the block's own pixels: the document's zoom
  // (CSS zoom) scales both, and unscaled the numbers drifted off their lines.
  const style = getComputedStyle(code);
  const zoom = box.height / (parseFloat(style.height) || box.height);
  // Lines with no character of their own - after a last newline - are a
  // row each, the block's line height.
  const row = parseFloat(style.lineHeight) || 0;
  const unmeasured = numbers.length - tops.length;
  const end = box.bottom - Math.max(0, unmeasured) * row * zoom;
  numbers.forEach((number, i) => {
    const height =
      i < tops.length
        ? ((i + 1 < tops.length ? tops[i + 1] : end) - tops[i]) / zoom
        : row;
    number.style.height = `${Math.max(0, height)}px`;
  });
}

/** The top of each line of `code`, in the viewport: of its first
 *  character, or of the newline that is all an empty line holds. */
function lineTops(code: HTMLElement): number[] {
  const tops: number[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let lineStart = true;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    for (let i = 0; i < text.data.length; i++) {
      if (lineStart) {
        range.setStart(text, i);
        range.setEnd(text, i + 1);
        const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
        tops.push(rect.top);
        lineStart = false;
      }
      if (text.data[i] === "\n") lineStart = true;
    }
  }
  return tops;
}
