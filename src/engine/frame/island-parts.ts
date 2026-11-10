import type { Edge, FramePart } from "./clock";
import type { Rect } from "./rect";
import type { IslandRects } from "./solve";

/** One island as the clock moves it: its key (it follows its tabs, so a
 *  split keeps the island that stays), its rects, the tab in front. */
export interface PlacedIsland {
  key: string;
  /** Its pane; null for the one island of a window not split. */
  paneId: string | null;
  rects: IslandRects;
  tabs: readonly string[];
  front: string | null;
}

/** The frame keys of an island's parts, and of the views lying on it. */
export const rowKey = (island: string) => `row:${island}`;
export const sheetKey = (island: string) => `sheet:${island}`;
export const viewKey = (tab: string) => `view:${tab}`;
export const cornerKey = (island: string) => `corner:${island}`;
export const dividerKey = (path: number[], index: number) =>
  `divider:${path.join(".")}:${index}`;

const shift = (r: Rect, o: { x: number; y: number }): Rect => ({
  ...r,
  x: r.x + o.x,
  y: r.y + o.y,
});

/** The edge a new island grows from: the side of the area it lies on, so
 *  the AI opening on the right comes in from the right. */
function edgeOf(r: Rect, area: Rect): Edge {
  if (Math.abs(r.x + r.w - (area.x + area.w)) < 1 && r.x > area.x + 1)
    return "right";
  if (Math.abs(r.x - area.x) < 1 && r.x + r.w < area.x + area.w - 1)
    return "left";
  if (Math.abs(r.y + r.h - (area.y + area.h)) < 1 && r.y > area.y + 1)
    return "bottom";
  return "right";
}

/** Every part the islands' area places, in the shell's coordinates. */
export function islandParts(
  islands: readonly PlacedIsland[],
  dividers: readonly { path: number[]; index: number; rect: Rect }[],
  area: Rect,
  origin: { x: number; y: number },
): Map<string, FramePart> {
  const parts = new Map<string, FramePart>();
  for (const { key, rects, front } of islands) {
    const grows = edgeOf(rects.whole, area);
    const sheet = sheetKey(key);
    // Its row at its full width throughout, standing on the sheet as the
    // sheet moves: its tabs are never laid out again mid-slide.
    if (rects.row)
      parts.set(rowKey(key), {
        rect: shift(rects.row, origin),
        follow: sheet,
        above: true,
      });
    parts.set(sheet, { rect: shift(rects.sheet, origin), grows });
    const onSheet = { rect: shift(rects.sheet, origin), follow: sheet };
    if (front) parts.set(viewKey(front), onSheet);
    parts.set(cornerKey(key), onSheet);
  }
  for (const { path, index, rect } of dividers)
    parts.set(dividerKey(path, index), { rect: shift(rect, origin) });
  return parts;
}
