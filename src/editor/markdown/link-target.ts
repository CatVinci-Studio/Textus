import { decodeUrlPath, dirname } from "../../utils/path";

/** Where a followed link leads (link-click-plugin.ts). */
export type LinkTarget =
  /** `#heading`: a heading in this document. */
  | { kind: "heading"; anchor: string }
  /** http(s) or mailto, for the system browser or mail app. */
  | { kind: "web"; url: string }
  /** A Markdown file, to open in a tab. */
  | { kind: "document"; path: string }
  /** Any other local file, to show in the file manager. */
  | { kind: "file"; path: string };

const MARKDOWN_FILE = /\.(md|markdown)$/i;

/**
 * Where `href`, a link in the document at `docPath`, leads - null when it
 * leads nowhere to follow. A relative path resolves against the document's
 * folder, so an unsaved document (no folder yet) follows only web links,
 * absolute paths and its own headings. Of the URL schemes only http(s) and
 * mailto are followed: javascript:, file:, data: and the like would hand
 * the document's author a way to run or open things, not a link.
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
  // A Windows drive path ("C:\..." / "C:/...") would otherwise read as a
  // single-letter URL scheme to the test below.
  const drive = /^[a-z]:[\\/]/i.test(link);
  if (!drive && /^[a-z][a-z0-9+.-]*:/i.test(link))
    return /^(https?|mailto):/i.test(link) ? { kind: "web", url: link } : null;
  // The anchor of a link into another file is dropped: that file opens at
  // its top.
  const hash = link.indexOf("#");
  const file = decodeUrlPath(hash < 0 ? link : link.slice(0, hash));
  if (!file) return null;
  const absolute = drive || /^[\\/]/.test(file);
  if (!absolute && !docPath) return null;
  const path = absolute ? file : `${dirname(docPath!)}/${file}`;
  // Spelled the way the OS spells it, so a document already open in a tab
  // (opened from a dialog, with "\" on Windows) is found by its path.
  const resolved = normalizePath(
    path,
    /^[a-z]:|^\\/i.test(absolute ? file : docPath!) ? "\\" : "/",
  );
  return MARKDOWN_FILE.test(resolved)
    ? { kind: "document", path: resolved }
    : { kind: "file", path: resolved };
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
