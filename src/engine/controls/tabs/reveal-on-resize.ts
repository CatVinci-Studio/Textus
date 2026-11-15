/**
 * Calls `again` whenever one of `targets` changes width after its first
 * measure: the open tab's reveal redone once the row, or its strip with a
 * closed tab still leaving, has its new width. `again`: a scroll was
 * asked for, maybe while the row still had its old width, so the first
 * measure reveals again too. Returns the stop.
 */
export function revealOnResize(
  targets: readonly (Element | null)[],
  again: () => void,
  asked = false,
): () => void {
  const widths = new Map<Element, number>();
  const resized = new ResizeObserver((entries) => {
    let changed = asked;
    asked = false;
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
