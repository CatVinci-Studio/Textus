import { windowTabs, tabInUse } from "../engine/layout/store";
import type { DocTab } from "../document/doc-tabs";
import { tabReadOnly } from "../document/read-only";
import { imageMimeForPath } from "../editor/images/pasted-files";
import { dirname, isNoteFile } from "../utils/path";
import { INSERT_MARKDOWN_EVENT, sendAppEvent } from "../utils/events";
import { linkStyleAt } from "./link-style";
import {
  linkToTarget,
  pathIndex,
  type LinkStyle,
  type PathIndex,
} from "./link-resolve";

/** The link to `path` written in the document `from`: a picture for an
 *  image (`![name](…)`, `![[name]]`), else a link, in the folder's style. */
export function fileLinkSource(
  paths: PathIndex,
  path: string,
  from: string,
  style: LinkStyle,
): string {
  const embed = imageMimeForPath(path) !== null;
  return linkToTarget(paths, path, from, style, embed ? { embed } : {});
}

/** The document a link to a file goes into: the tab in use, saved, a note,
 *  and open to writing; null when there is none. */
export function documentToLinkFrom(
  tabs: readonly DocTab[],
  inUse: string,
): string | null {
  const tab = tabs.find((t) => t.id === inUse);
  if (!tab?.path || tab.view || !isNoteFile(tab.path) || tabReadOnly(tab))
    return null;
  return tab.path;
}

/** `documentToLinkFrom` for the window's tabs. */
export const linkingDocument = (): string | null =>
  documentToLinkFrom(windowTabs<DocTab>(), tabInUse());

/** A link to `path` put in at the caret of the document `from`, written
 *  as links there are (standard with %20, or wiki in a vault that uses
 *  them); `root` is the folder links resolve in. */
export async function linkToFile(
  path: string,
  from: string,
  root: string | null,
): Promise<void> {
  const style = await linkStyleAt(from);
  const paths = pathIndex(root ?? dirname(from), [path, from]);
  sendAppEvent(INSERT_MARKDOWN_EVENT, fileLinkSource(paths, path, from, style));
}
