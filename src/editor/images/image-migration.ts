import { fs } from "../../platform/ipc";
import { decodeLocalPath } from "../../utils/path";

// Matches standard markdown image syntax: ![alt](src "optional title") -
// how image-plugin.ts's paste handler inserts a src, and so how draft
// images always show up in the serialized markdown.
const IMAGE_SRC_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

// Mirrors image-plugin.ts's resolveImageSrc: a Windows drive path or a
// leading "/" is an absolute local path; anything with a URL scheme
// (http(s), data:, asset:, ...) or a plain relative path is not.
function isAbsoluteLocalPath(src: string): boolean {
  if (/^[a-z]:[\\/]/i.test(src)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return false;
  return src.startsWith("/");
}

function extractImageSrcs(content: string, includeRelative: boolean): string[] {
  const srcs = new Set<string>();
  for (const match of content.matchAll(IMAGE_SRC_RE)) {
    if (
      isAbsoluteLocalPath(match[1]) ||
      (includeRelative && match[1].startsWith("assets/"))
    )
      srcs.add(match[1]);
  }
  return [...srcs];
}

function replaceAll(content: string, from: string, to: string): string {
  return content.split(from).join(to);
}

/**
 * A draft's pasted images live in the app's data dir with an absolute src
 * (see fs.rs's save_pasted_image) until the document itself is saved
 * somewhere real - called right after a first save (app/useSaveTabs.ts's
 * saveTabAs) to copy them into an `assets/` folder next to the document and
 * rewrite the markdown to the new relative paths. A no-op (empty result)
 * for documents with no draft-origin images, which is the common case.
 */
export async function migrateDraftImages(
  docPath: string,
  content: string,
  sourceDocPath: string | null = null,
): Promise<{
  content: string;
  migrated: boolean;
  failed: string[];
  mappings: { old: string; new: string }[];
}> {
  const candidates = extractImageSrcs(content, !!sourceDocPath);
  if (candidates.length === 0)
    return { content, migrated: false, failed: [], mappings: [] };

  // Generated images are written percent-encoded; the backend needs the real
  // path, while the Markdown is rewritten using the original spelling.
  const original = new Map(
    candidates.map((src) => [decodeLocalPath(src), src]),
  );
  const results = await fs.migrateDraftImages(
    docPath,
    [...original.keys()],
    sourceDocPath,
  );
  let next = content;
  const failed: string[] = [];
  let migrated = false;
  const mappings: { old: string; new: string }[] = [];
  for (const { old: decoded, new: replacement } of results) {
    const old = original.get(decoded) ?? decoded;
    if (replacement) {
      next = replaceAll(next, old, replacement);
      migrated = true;
      mappings.push({ old, new: replacement });
    } else {
      failed.push(old);
    }
  }
  return { content: next, migrated, failed, mappings };
}
