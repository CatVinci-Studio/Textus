/**
 * Calls `again` whenever one of `targets` changes width after its first
 * measure: the open tab's reveal redone once the row, or its strip with a
 * closed tab still leaving, has its new width. Returns the stop.
 */
export function revealOnResize(
  targets: readonly (Element | null)[],
  again: () => void,
): () => void {
  const widths = new Map<Element, number>();
  const resized = new ResizeObserver((entries) => {
    let changed = false;
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
