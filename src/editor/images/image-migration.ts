import { fs } from "../../platform/ipc";
import { decodeUrlPath, hasUrlScheme, isDrivePath } from "../../utils/path";

// ![alt](src "title"), the form pasted images are written in. A src with a
// space is in angle brackets, as a macOS draft path ("Application Support").
const IMAGE_SRC_RE =
  /(!\[[^\]]*\]\()(?:<([^>\n]+)>|([^)\s]+))((?:\s+"[^"]*")?\))/g;

// A Windows drive path or a leading "/" is absolute; a URL scheme or a
// plain relative path is not.
function isAbsoluteLocalPath(src: string): boolean {
  if (isDrivePath(src)) return true;
  if (hasUrlScheme(src)) return false;
  return src.startsWith("/");
}

function isRelativePath(src: string): boolean {
  return !!src && !hasUrlScheme(src) && !src.startsWith("#");
}

/** Each image src as written, and the path it names, decoded. */
function extractImageSrcs(
  content: string,
  withRelative: boolean,
): Map<string, string> {
  const srcs = new Map<string, string>();
  for (const match of content.matchAll(IMAGE_SRC_RE)) {
    const written = match[2] ?? match[3];
    if (
      isAbsoluteLocalPath(written) ||
      (withRelative && isRelativePath(written))
    )
      srcs.set(written, decodeUrlPath(written));
  }
  return srcs;
}

// A space or a parenthesis would end a bare link destination, so those are
// percent-encoded.
function linkDestination(src: string): string {
  return src.replace(
    /[ ()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Rewrites the src of every image whose src is in `moved`; the same words
 *  in the text stay. */
function rewriteImageSrcs(content: string, moved: Map<string, string>): string {
  return content.replace(
    IMAGE_SRC_RE,
    (whole, open: string, bracketed?: string, bare?: string, close = "") => {
      const next = moved.get(bracketed ?? bare ?? "");
      if (next === undefined) return whole;
      return bracketed !== undefined
        ? `${open}<${next}>${close}`
        : `${open}${linkDestination(next)}${close}`;
    },
  );
}

/**
 * Brings a document's images along when it is saved to a file: a draft's
 * pasted images (absolute, in the app's data dir) move into the image
 * folder, and on a Save As relative ones are copied too. The markdown is
 * rewritten to the new relative paths.
 */
export async function migrateDraftImages(
  docPath: string,
  content: string,
  folder: string,
  sourceDocPath: string | null = null,
): Promise<{ content: string; migrated: boolean; failed: string[] }> {
  const candidates = extractImageSrcs(content, sourceDocPath !== null);
  if (candidates.size === 0) return { content, migrated: false, failed: [] };

  const written = new Map(
    [...candidates].map(([src, path]) => [path, src] as const),
  );
  const results = await fs.migrateDraftImages(
    docPath,
    [...written.keys()],
    folder,
    sourceDocPath,
  );
  const moved = new Map<string, string>();
  const failed: string[] = [];
  for (const { old, new: replacement } of results) {
    const src = written.get(old) ?? old;
    if (replacement) moved.set(src, replacement);
    else failed.push(src);
  }
  return {
    content: moved.size > 0 ? rewriteImageSrcs(content, moved) : content,
    migrated: moved.size > 0,
    failed,
  };
}
