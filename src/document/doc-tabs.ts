import { firstLevelOneHeading } from "./save-default-name";
import type { Strings } from "../i18n/strings";
import { basename } from "../utils/path";
import { fs } from "../platform/ipc";
import { detectFormat, toEditorText, toFileText } from "./file-format";

// Every bundled guide, by file name: "src/help/<doc>-guide.<lang>.md". A
// language without its own copy of a guide gets the English one, so a
// translated guide is a new file there and no change here.
const HELP_GUIDES = import.meta.glob<string>("../help/*-guide.*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

// The document-tab data model shared by app/useTabState.ts (tab state) and
// useTabDragMerge.ts (tabs in flight between windows).

// Mirrors the doc ids Rust puts in its Help menu ids (menu.rs
// HELP_DOC_PREFIX) - they arrive here as the menu-open-help payload.
// "welcome" isn't a bundled document - it starts the onboarding tour
// (src/onboarding/) on a practice tab instead, handled entirely in
// menu-bridge.ts's menu-open-help listener, so it never reaches helpDocContent.
export type HelpDoc = "markdown" | "agent";

export interface DocTab {
  id: string;
  /** Keeps the workspace identity when a recovered tab receives a new UI id. */
  workspaceId?: string;
  path: string | null;
  content: string;
  // What's on disk (or "" for a fresh draft) - dirtiness is divergence from
  // this, and it's what the close-confirmation prompt keys off.
  savedContent: string;
  // Disk mtime (ms) snapshotted when this document was last read from or
  // written to disk; null for drafts and for documents whose mtime is
  // unknown (e.g. a tab received from another window). Divergence from the
  // live mtime means the file changed externally - clean tabs reload on
  // window focus, dirty tabs get an overwrite prompt on save.
  diskMtime: number | null;
  sourceMode: boolean;
  /** Source mode with a rendered preview beside it (editor/modes/SplitView.tsx).
   *  Only meaningful while sourceMode is on. */
  splitView?: boolean;
  reloadKey: number;
  // A bundled Help menu document: still a pathless draft (edits never touch
  // disk; Save goes through Save As), but titled after itself instead of
  // "Untitled", and deduped per doc so Help focuses the existing tab rather
  // than opening another copy.
  helpDoc?: HelpDoc;
}

// The document part of a tab in flight between windows - what
// start_floating_tab_drag hands to Rust and take_detached_tab /
// receive-detached-tab hand back (tab_drag.rs DetachedTab).
export interface DetachedTabDoc {
  workspaceId?: string;
  path: string | null;
  content: string;
  savedContent: string;
  diskMtime: number | null;
  helpDoc?: HelpDoc;
}

export function helpDocContent(doc: HelpDoc, lang: string): string {
  return (
    HELP_GUIDES[`../help/${doc}-guide.${lang}.md`] ??
    HELP_GUIDES[`../help/${doc}-guide.en.md`]
  );
}

// A tab's display name everywhere one is shown (tab pill, title strip,
// detached-drag pill, export default filename).
/** Settings > Textus AI > Name new documents automatically: an unsaved
 *  document is called by its first heading. Set by App from settings. */
let headingTitles = false;
export function setHeadingTitles(enabled: boolean) {
  headingTitles = enabled;
}

/** Titles the text model suggested for unsaved documents, by tab id: they
 *  name the tab and the Save dialog without editing the text (an inserted
 *  heading would have been a second Undo step after accepting a draft). */
const suggestedTitles = new Map<string, string>();
export const TITLES_CHANGED = "textus-tab-titles";
/** A past Agent task opened from the history list: App brings up its
 *  document (by file, open tab or saved snapshot) and the editor showing it
 *  restores the conversation. */
export const OPEN_TASK_EVENT = "textus:open-task";
export const RESTORE_TASK_EVENT = "textus:restore-task";
export interface OpenTask {
  entryId: string;
  docPath: string | null;
  documentId: string | null;
  snapshot: string | null;
  title: string;
}
/** Which editor should restore which conversation: `path:<file>` or
 *  `doc:<documentId>` → history entry id. */
export const pendingTaskRestores = new Map<string, string>();

/** Save As moved a document's images: the tab's editor rewrites their srcs
 *  in place and sets `handled` (useSaveTabs, MilkdownEditor). */
export const REWRITE_IMAGE_SRCS_EVENT = "textus:rewrite-image-srcs";
export interface RewriteImageSrcs {
  tabId: string;
  mappings: { old: string; new: string }[];
  handled: boolean;
}

/** Tabs whose document is in use beyond its text: an Agent conversation,
 *  a pending draft or an image in progress (MilkdownEditor reports them).
 *  Opening a file never replaces such a tab in place. */
const engagedTabs = new Set<string>();
export function setTabEngaged(tabId: string, engaged: boolean) {
  if (engaged) engagedTabs.add(tabId);
  else engagedTabs.delete(tabId);
}
export function tabIsEngaged(tabId: string): boolean {
  return engagedTabs.has(tabId);
}

/** Agent or Write: one mode for the whole window (MilkdownEditor sets it).
 *  Null until the first editor decides. */
let windowSurface: boolean | null = null;
export function windowShowsAgent(): boolean {
  return windowSurface === true;
}
export function getWindowSurface(): boolean | null {
  return windowSurface;
}
export function setWindowSurface(agent: boolean) {
  windowSurface = agent;
}

/** Nothing to lose: no file, no text, no Agent work. */
export function tabIsPristine(tab: DocTab): boolean {
  return (
    !tab.path && !tab.helpDoc && !tab.content.trim() && !engagedTabs.has(tab.id)
  );
}
/** Asks App for a blank tab in this window (the Agent home's New document). */
export const NEW_DOCUMENT_EVENT = "textus:new-document";
export function setSuggestedTitle(tabId: string, title: string) {
  suggestedTitles.set(tabId, title);
  window.dispatchEvent(new Event(TITLES_CHANGED));
}
export function hasSuggestedTitle(tabId: string): boolean {
  return suggestedTitles.has(tabId);
}
export function suggestedTitle(tab: DocTab): string | null {
  return headingTitles && !tab.path
    ? (suggestedTitles.get(tab.id) ?? null)
    : null;
}

export function tabTitle(tab: DocTab, t: Strings): string {
  if (tab.path) return basename(tab.path);
  if (tab.helpDoc === "markdown") return t.markdownGuideTab;
  if (tab.helpDoc === "agent") return t.agentGuideTab;
  if (headingTitles) {
    // A title sits at the top: the head of the text is enough, and keeps
    // this cheap for a long draft rendered on every keystroke.
    const heading =
      firstLevelOneHeading(tab.content.slice(0, 4000)) ??
      suggestedTitles.get(tab.id);
    if (heading)
      return heading.length > 40 ? `${heading.slice(0, 40)}…` : heading;
  }
  return t.untitledTab;
}

export function makeBlankTab(): DocTab {
  return {
    id: crypto.randomUUID(),
    path: null,
    content: "",
    savedContent: "",
    diskMtime: null,
    sourceMode: false,
    reloadKey: 0,
  };
}

export function tabIsDirty(tab: DocTab): boolean {
  return tab.content !== tab.savedContent;
}

// The full invoke arguments for start_floating_tab_drag - built here so the
// two drag flows (tab pulled from a bar, whole single-tab window dragged)
// can't drift apart on which fields travel with the document.
export function floatingDragArgs(
  tab: DocTab,
  t: Strings,
  destroySource: boolean,
) {
  return {
    tab: {
      workspaceId: tab.workspaceId ?? tab.id,
      path: tab.path,
      content: tab.content,
      savedContent: tab.savedContent,
      diskMtime: tab.diskMtime,
      helpDoc: tab.helpDoc ?? null,
    },
    title: tabTitle(tab, t),
    dirty: tabIsDirty(tab),
    destroySource,
  };
}

// Errors (permission issues, network mounts) are treated the same as "no
// mtime available": external-change detection degrades to doing nothing
// rather than blocking opens/saves.
export async function statMtime(path: string): Promise<number | null> {
  try {
    return await fs.fileMtimeMs(path);
  } catch {
    return null;
  }
}

/** A document's text as the editor holds it: "\n" line breaks, no BOM
 *  (file-format.ts). */
export async function readDocText(path: string): Promise<string> {
  return toEditorText(await fs.readTextFile(path));
}

export async function readDocFromDisk(
  path: string,
): Promise<{ content: string; diskMtime: number | null }> {
  const content = await readDocText(path);
  return { content, diskMtime: await statMtime(path) };
}

/** Writes a document, in the line endings and BOM the file already has on
 *  disk (a new file gets "\n" and none). Read at save time rather than
 *  remembered from the open, so it holds however the tab got here - a
 *  reload, a restored session, a tab dragged in from another window. */
export async function writeDocFile(
  path: string,
  content: string,
): Promise<void> {
  const existing = await fs.readTextFile(path).catch(() => null);
  const format =
    existing === null ? { crlf: false, bom: false } : detectFormat(existing);
  await fs.writeTextFile(path, toFileText(content, format));
}
