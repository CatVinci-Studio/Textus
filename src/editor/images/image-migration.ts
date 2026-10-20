import { fs } from "../../platform/ipc";
import { decodeUrlPath, hasUrlScheme, isDrivePath } from "../../utils/path";

// Matches standard markdown image syntax: ![alt](src "optional title") -
// how image-plugin.ts's paste handler inserts a src, and so how draft
// images always show up in the serialized markdown. A src with a space is
// written in angle brackets, ![](<a b.png>) - a draft's own path on macOS
// ("Application Support") among them.
const IMAGE_SRC_RE =
  /(!\[[^\]]*\]\()(?:<([^>\n]+)>|([^)\s]+))((?:\s+"[^"]*")?\))/g;

// Mirrors image-plugin.ts's resolveImageSrc: a Windows drive path or a
// leading "/" is an absolute local path; anything with a URL scheme
// (http(s), data:, asset:, ...) or a plain relative path is not.
function isAbsoluteLocalPath(src: string): boolean {
  if (isDrivePath(src)) return true;
  if (hasUrlScheme(src)) return false;
  return src.startsWith("/");
}

function isRelativePath(src: string): boolean {
  return !!src && !hasUrlScheme(src) && !src.startsWith("#");
}

/** Each image src as written, and the path it names (decoded, as the
 *  editor reads it - image-plugin.ts's resolveImageSrc). */
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

// The new src as a bare link destination may spell it: a space or a
// parenthesis would end it, so those are percent-encoded, as decodeUrlPath
// reads them back.
function linkDestination(src: string): string {
  return src.replace(
    /[ ()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Rewrites the src of every image whose src (as written) is in `moved` -
 *  only image links: the same words in the text stay. */
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
 * Brings a document's images along when it is saved to a file - called
 * right after the save (app/useSaveTabs.ts's saveTabAs). A draft's pasted
 * images live in the app's data dir with an absolute src (see fs.rs's
 * save_pasted_image) and move into the document's image folder (`folder`,
 * Settings > Images); with `sourceDocPath`, a Save As of a document that
 * had a file, its relative images are copied there too, or the new file's
 * links would point at nothing. The markdown is rewritten to the new
 * relative paths. A no-op (empty result) for documents with no such
 * images, which is the common case.
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
