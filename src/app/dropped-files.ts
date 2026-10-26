import { imageMimeForPath } from "../editor/images/pasted-files";

/**
 * Files dropped from a file manager arrive as a Tauri event with paths, never
 * as an HTML5 drop. Images go into the document; everything else opens like
 * File > Open.
 */
export function sortDroppedPaths(paths: string[]): {
  documents: string[];
  images: string[];
} {
  const documents: string[] = [];
  const images: string[] = [];
  for (const path of paths) {
    if (!path) continue;
    (imageMimeForPath(path) ? images : documents).push(path);
  }
  return { documents, images };
}

/**
 * Where a drop landed, in CSS pixels. Tauri types it as physical, but only
 * Windows sends physical pixels; the webkit engines send logical ones.
 */
export function dropPointInPage(
  position: { x: number; y: number },
  physicalPixels: boolean,
  devicePixelRatio: number,
): { x: number; y: number } {
  const scale = physicalPixels && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { x: position.x / scale, y: position.y / scale };
}
