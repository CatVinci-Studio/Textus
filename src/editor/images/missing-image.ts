import { IMAGE_ICON_HTML } from "../../ui/icons";
import { exportDoc, fs } from "../../platform/ipc";
import type { Strings } from "../../i18n/strings";
import {
  basename,
  decodeUrlPath,
  hasUrlScheme,
  isDrivePath,
  parentDir,
} from "../../utils/path";
import { localPath } from "../markdown/link-target";

/**
 * The card a picture that won't load shows in its place (issue: the
 * browser's broken-image icon named neither the image nor the reason). A
 * Markdown image (image-plugin.ts) and an Obsidian embed whose file isn't
 * in the vault (obsidian-embed-preview.ts) both show it: the file's name,
 * why it isn't there, and the way to fix it - choose another image, or
 * look in the folder it was expected in.
 *
 * It is editor chrome: an export (export/exporters.ts) drops the card and
 * the wrapper's MISSING_IMAGE_CLASS, so a page shows what it showed before.
 */

/** On an image's wrapper while its card stands in for the picture. */
export const MISSING_IMAGE_CLASS = "image-missing";
export const MISSING_IMAGE_CARD_CLASS = "missing-image-card";

/** Where an image's src points. */
export type ImageLocation =
  /** A file on this computer, as a full path. */
  | { kind: "local"; path: string }
  /** An http(s) address. */
  | { kind: "remote"; url: string; host: string }
  /** A relative path in a document not saved yet: no folder to look in. */
  | { kind: "unsaved" }
  /** Anything else (data:, file:, a document read through iOS Files). */
  | { kind: "other" };

/** Where `src`, an image in the document at `docPath`, points - as
 *  resolveImageSrc (image-plugin.ts) reads it. */
export function imageLocation(
  src: string,
  docPath: string | null,
): ImageLocation {
  const value = src.trim();
  if (!isDrivePath(value) && hasUrlScheme(value)) {
    if (!/^https?:/i.test(value)) return { kind: "other" };
    try {
      return { kind: "remote", url: value, host: new URL(value).host };
    } catch {
      return { kind: "other" };
    }
  }
  if (docPath && hasUrlScheme(docPath) && !isDrivePath(docPath))
    return { kind: "other" };
  const path = localPath(decodeUrlPath(value), docPath);
  if (path) return { kind: "local", path };
  return value ? { kind: "unsaved" } : { kind: "other" };
}

/** Why the picture didn't show. */
export type MissingReason =
  "notFound" | "unsupported" | "remote" | "unsaved" | "notInVault" | "failed";

/** The reason for `location`, given whether its file is on disk (null
 *  when that couldn't be asked). A local file that is there but still
 *  failed to load is one the webview can't show: a HEIC, a TIFF outside
 *  Safari, a damaged file. */
export function missingReason(
  location: ImageLocation,
  exists: boolean | null,
): MissingReason {
  switch (location.kind) {
    case "local":
      if (exists === null) return "failed";
      return exists ? "unsupported" : "notFound";
    case "remote":
      return "remote";
    case "unsaved":
      return "unsaved";
    default:
      return "failed";
  }
}

/** The name the card calls an image by: the src's last part, decoded; a
 *  web address with no file name goes by its host. */
export function imageDisplayName(src: string): string {
  const value = src.trim();
  if (/^https?:/i.test(value)) {
    try {
      const url = new URL(value);
      return decodeUrlPath(basename(url.pathname)) || url.host;
    } catch {
      return value;
    }
  }
  if (!isDrivePath(value) && hasUrlScheme(value)) return value.slice(0, 40);
  return decodeUrlPath(basename(value)) || value;
}

/** `path` itself if it exists, else the nearest folder above it that
 *  does; null when none can be found. */
export async function nearestExisting(
  path: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string | null> {
  let current: string | null = path;
  while (current) {
    if (await exists(current)) return current;
    current = parentDir(current);
  }
  return null;
}

/** Whether a file or folder is there; null when the backend couldn't
 *  say (no permission, an iOS-only path). */
async function pathExists(path: string): Promise<boolean | null> {
  try {
    return (await fs.fileMtimeMs(path)) !== null;
  } catch {
    return null;
  }
}

/** Why the image at `location` didn't load, asking the backend whether a
 *  local file is there - a load error alone can't tell a missing file
 *  from one the webview can't show. */
export async function probeMissing(
  location: ImageLocation,
): Promise<MissingReason> {
  return missingReason(
    location,
    location.kind === "local" ? await pathExists(location.path) : null,
  );
}

/** "Show in folder": the file manager at the image if it is there, else at
 *  the nearest folder above it that is. */
export function revealNearest(path: string): void {
  void nearestExisting(path, async (p) => (await pathExists(p)) === true)
    .then((found) => (found ? exportDoc.revealInDir(found) : undefined))
    .catch(() => {});
}

export interface MissingCardContent {
  name: string;
  alt: string;
  reason: MissingReason;
  /** Where it was looked for - shown on hover. */
  location: ImageLocation;
  /** Each action the card offers; one left out isn't shown. */
  onChoose?: () => void;
  onReveal?: () => void;
}

function reasonText(content: MissingCardContent, t: Strings): string {
  switch (content.reason) {
    case "notFound":
      return t.missingImageNotFound;
    case "unsupported":
      return t.missingImageUnsupported;
    case "remote":
      return t.missingImageRemote.replace(
        "{host}",
        content.location.kind === "remote" ? content.location.host : "",
      );
    case "unsaved":
      return t.missingImageUnsaved;
    case "notInVault":
      return t.missingImageNotInVault;
    default:
      return t.missingImageFailed;
  }
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = className;
  el.textContent = text;
  return el;
}

/** The card's element. Spans, not divs: it sits inside a paragraph. */
export function missingImageCard(
  content: MissingCardContent,
  t: Strings,
): HTMLElement {
  const card = document.createElement("span");
  card.className = MISSING_IMAGE_CARD_CLASS;
  card.contentEditable = "false";
  const { location } = content;
  if (location.kind === "local") card.title = location.path;
  else if (location.kind === "remote") card.title = location.url;

  const head = document.createElement("span");
  head.className = "missing-image-head";
  const icon = document.createElement("span");
  icon.className = "missing-image-icon";
  icon.innerHTML = IMAGE_ICON_HTML;
  const title = (
    content.reason === "unsupported"
      ? t.missingImageUnsupportedTitle
      : t.missingImageTitle
  ).replace("{name}", content.name);
  head.append(icon, span("missing-image-title", title));
  card.append(head);

  const alt = content.alt.trim();
  if (alt && alt !== content.name) card.append(span("missing-image-alt", alt));
  card.append(span("missing-image-reason", reasonText(content, t)));

  const actions: [string, string, () => void][] = [];
  if (content.onChoose)
    actions.push(["choose", t.missingImageChoose, content.onChoose]);
  if (content.onReveal)
    actions.push(["reveal", t.imageReveal, content.onReveal]);
  if (actions.length > 0) {
    const row = document.createElement("span");
    row.className = "missing-image-actions";
    for (const [name, label, run] of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = name;
      button.textContent = label;
      // The editor would take the press as a click into the document:
      // a selection change, or the embed's source opening under the caret.
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        run();
      });
      row.append(button);
    }
    card.append(row);
  }
  return card;
}

/** Whether an event started on one of a card's buttons - which the
 *  editor must leave alone. */
export function isMissingCardAction(event: Event): boolean {
  const target = event.target as Element | null;
  return !!target?.closest?.(".missing-image-actions");
}
