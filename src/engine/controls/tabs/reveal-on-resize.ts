/**
 * Calls `again` on the first measure of `targets` and whenever one changes
 * width after: the open tab's reveal redone once the row, or its strip with
 * a closed tab still leaving, has its new width. The first too, since the
 * reveal may have run while the row still had its old width. Returns the
 * stop.
 */
export function revealOnResize(
  targets: readonly (Element | null)[],
  again: () => void,
): () => void {
  const widths = new Map<Element, number>();
  let first = true;
  const resized = new ResizeObserver((entries) => {
    let changed = first;
    first = false;
    for (const { target, contentRect } of entries) {
      const was = widths.get(target);
      if (was !== undefined && was !== contentRect.width) changed = true;
      widths.set(target, contentRect.width);
    }
    if (changed) again();
  });
  for (const target of targets) if (target) resized.observe(target);
  return () => resized.disconnect();
}
