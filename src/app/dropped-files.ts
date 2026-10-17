import { imageMimeForPath } from "../editor/images/pasted-files";

/**
 * Files dropped on the window from a file manager (issue #78). Tauri's
 * webview drag-drop handling takes OS file drops before the page sees them
 * - on every desktop platform, Windows included - and hands them over as a
 * `tauri://drag-drop` event with the files' paths, so a drop never reaches
 * the editor as an HTML5 drop. Images go into the document, as a pasted
 * image file does; everything else opens like File > Open.
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
 * Where a drop landed, in the page's CSS pixels. Tauri types the position
 * as physical, but only Windows sends physical pixels (wry maps the cursor
 * to the window's client area); WebKitGTK and WKWebView hand over their own
 * logical coordinates as they are.
 */
export function dropPointInPage(
  position: { x: number; y: number },
  physicalPixels: boolean,
  devicePixelRatio: number,
): { x: number; y: number } {
  const scale = physicalPixels && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { x: position.x / scale, y: position.y / scale };
}
