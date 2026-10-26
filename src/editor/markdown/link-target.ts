import {
  decodeUrlPath,
  dirname,
  hasUrlScheme,
  isDrivePath,
} from "../../utils/path";

/** Where a followed link leads. */
export type LinkTarget =
  /** `#heading`: a heading in this document. */
  | { kind: "heading"; anchor: string }
  /** http(s) or mailto, for the system browser or mail app. */
  | { kind: "web"; url: string }
  /** A Markdown file, to open in a tab, at the heading `anchor` names. */
  | { kind: "document"; path: string; anchor?: string }
  /** Any other local file, to show in the file manager. */
  | { kind: "file"; path: string };

const MARKDOWN_FILE = /\.(md|markdown)$/i;

/**
 * Where `href`, a link in the document at `docPath`, leads, or null. Of URL
 * schemes only http(s) and mailto are followed: javascript:, file: and the
 * like would let a document's author run or open things.
 */
export function linkTarget(
  href: string,
  docPath: string | null,
): LinkTarget | null {
  const link = href.trim();
  if (link.startsWith("#"))
    return link.length > 1
      ? { kind: "heading", anchor: decodeUrlPath(link.slice(1)) }
      : null;
  // A Windows drive path would otherwise read as a one-letter URL scheme.
  const drive = isDrivePath(link);
  if (!drive && hasUrlScheme(link))
    return /^(https?|mailto):/i.test(link) ? { kind: "web", url: link } : null;
  const hash = link.indexOf("#");
  const resolved = localPath(
    decodeUrlPath(hash < 0 ? link : link.slice(0, hash)),
    docPath,
  );
  if (!resolved) return null;
  // Any other file is only shown in the file manager, where an anchor leads
  // nowhere.
  if (!MARKDOWN_FILE.test(resolved)) return { kind: "file", path: resolved };
  const anchor = hash < 0 ? "" : decodeUrlPath(link.slice(hash + 1));
  return anchor
    ? { kind: "document", path: resolved, anchor }
    : { kind: "document", path: resolved };
}

/**
 * A decoded path from the document at `docPath` as a full path, or null for
 * a relative one in an unsaved document. Spelled the way the OS spells it,
 * so a document already open in a tab is found by its path.
 */
export function localPath(file: string, docPath: string | null): string | null {
  if (!file) return null;
  const absolute = isDrivePath(file) || /^[\\/]/.test(file);
  if (!absolute && !docPath) return null;
  const path = absolute ? file : `${dirname(docPath!)}/${file}`;
  return normalizePath(
    path,
    /^[a-z]:|^\\/i.test(absolute ? file : docPath!) ? "\\" : "/",
  );
}

/** `path` with "." and ".." steps taken and `sep` between its parts. */
function normalizePath(path: string, sep: "/" | "\\"): string {
  const drive = /^[a-z]:/i.exec(path)?.[0] ?? "";
  const rest = path.slice(drive.length);
  // One leading separator for a root, two for a UNC share (\\server\share).
  const root = Math.min(/^[\\/]*/.exec(rest)![0].length, 2);
  const parts: string[] = [];
  for (const part of rest.split(/[\\/]+/)) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return drive + sep.repeat(root) + parts.join(sep);
}

/** A heading's anchor as GitHub writes it: lower case, punctuation dropped,
 *  spaces as "-" - letters of any script kept, so `#章節一` works. */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}
