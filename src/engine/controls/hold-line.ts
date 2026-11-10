/// The top-level block of `blocks` at viewport y `line`: the one it falls
/// in, else the first below it.
export function blockAt(blocks: Element, line: number): Element | null {
  for (const block of Array.from(blocks.children)) {
    if (block.getBoundingClientRect().bottom >= line) return block;
  }
  return null;
}

/// Runs `change`, anything that reflows the document, with the line at
/// viewport y `line` held still: `block` keeps the same share of its height there.
export function holdBlock(
  scroller: HTMLElement,
  block: Element,
  line: number,
  change: () => void,
) {
  const was = block.getBoundingClientRect();
  const share = was.height > 0 ? (line - was.top) / was.height : 0;
  change();
  const now = block.getBoundingClientRect();
  scroller.scrollTop += now.top + share * now.height - line;
}
