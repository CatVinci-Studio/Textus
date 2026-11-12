import { localPath } from "../markdown/link-target";
import { decodeUrlPath, hasUrlScheme, isDrivePath } from "../../utils/path";

/** Where a document's image points: one reading for the editor, the
 *  missing-picture card and export. */
export type ImageSource =
  /** An http(s) address; `//host/x.png` is one without its scheme. */
  | { kind: "web"; url: string }
  /** A file on this computer. `rooted`: written from `/`, which the
   *  editor and export look for under the document's link root first. */
  | { kind: "file"; path: string; rooted: boolean }
  /** Another machine's share (`\\host\x.png`): never looked at, since on
   *  Windows that alone sends the user's sign-in to it. */
  | { kind: "share" }
  /** A relative path in a document not saved yet: no folder to look in. */
  | { kind: "unsaved" }
  /** Relative to a document read through iOS Files (a file: URL). */
  | { kind: "scoped" }
  /** Anything else: data:, asset:, file:, empty. */
  | { kind: "other" };

/** Where `src`, an image in the document at `docPath`, points. */
export function imageSource(src: string, docPath: string | null): ImageSource {
  const value = src.trim();
  // A Windows drive path ("C:\..." / "C:/...") would otherwise read as a
  // single-letter URL scheme.
  if (isDrivePath(value))
    return { kind: "file", path: decodeUrlPath(value), rooted: false };
  if (!value) return { kind: "other" };
  if (hasUrlScheme(value))
    return /^https?:/i.test(value)
      ? { kind: "web", url: value }
      : { kind: "other" };
  if (value.startsWith("//")) return { kind: "web", url: `https:${value}` };
  if (value.startsWith("\\\\")) return { kind: "share" };
  const rooted = value.startsWith("/");
  if (!rooted && docPath && hasUrlScheme(docPath) && !isDrivePath(docPath))
    return { kind: "scoped" };
  const path = localPath(decodeUrlPath(value), docPath);
  return path ? { kind: "file", path, rooted } : { kind: "unsaved" };
}
