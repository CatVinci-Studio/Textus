import { fs } from "../../platform/ipc";
import { windowFolder } from "../../platform/window-folder";
import { decodeUrlPath } from "../../utils/path";

/** A root read this long ago is read again: the front matter may change. */
const FRESH_MS = 3000;

const roots = new Map<string, { at: number; root: Promise<string | null> }>();

/** Where `/` points for `doc`: its typora-root-url, its site's, vault's or
 *  repository's root, or the window's folder; null for the disk's root. */
function linkRoot(doc: string): Promise<string | null> {
  const known = roots.get(doc);
  if (known && Date.now() - known.at < FRESH_MS) return known.root;
  const root = fs.documentLinkRoot(doc, windowFolder()).catch(() => null);
  roots.set(doc, { at: Date.now(), root });
  return root;
}

/**
 * The file a `/`-started image src names in `doc`: under the document's
 * link root, as Typora and GitHub read it, unless only the disk path holds
 * the picture (`/Users/me/a.png`).
 */
export async function rootedImagePath(
  src: string,
  doc: string,
): Promise<string> {
  const path = decodeUrlPath(src);
  const root = await linkRoot(doc);
  if (!root) return path;
  const inRoot = `${root.replace(/[\\/]+$/, "")}${path}`;
  if ((await fs.fileMtimeMs(inRoot)) !== null) return inRoot;
  return (await fs.fileMtimeMs(path)) !== null ? path : inRoot;
}
