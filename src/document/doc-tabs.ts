import type { Strings } from "../i18n/strings";
import { basename } from "../utils/path";
import { lazyModule } from "../lazy/lazy-module";
import { fs } from "../platform/ipc";
import { detectFormat, toEditorText, toFileText } from "./file-format";
import type { PluginTabView } from "../plugins/app-bridge";

// Every bundled guide, by file name: "src/help/<doc>-guide.<lang>.md". A
// language without its own copy of a guide gets the English one, so a
// translated guide is a new file there and no change here. Each loads when
// it is first opened (lazy-module.ts).
const HELP_GUIDES = new Map(
  Object.entries(
    import.meta.glob<string>("../help/*-guide.*.md", {
      query: "?raw",
      import: "default",
    }),
  ).map(([path, load]) => [
    path,
    lazyModule(`help:${path.slice("../help/".length, -".md".length)}`, load),
  ]),
);

// The document-tab data model shared by app/tabs/useTabState.ts (tab state) and
// useTabDragMerge.ts (tabs in flight between windows).

// Mirrors the doc ids Rust puts in its Help menu ids (menu.rs
// HELP_DOC_PREFIX) - they arrive here as the menu-open-help payload.
// "welcome" isn't a bundled document - it starts the onboarding tour
// (src/onboarding/) on a practice tab instead, handled entirely in
// menu-bridge.ts's menu-open-help listener, so it never reaches helpDocContent.
export type HelpDoc = "markdown" | "agent";

export interface DocTab {
  id: string;
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
  /** The Word document this one was made from (document/word-import.ts),
   *  until it is first saved: a pathless draft named after the Word file,
   *  whose Save As starts beside it. The Word file is never written. */
  importedFrom?: string;
  /** A pathless draft's own name instead of "Untitled" - a plugin's usage
   *  guide, a document a plugin opened with a title. */
  draftTitle?: string;
  /** A plugin's view or custom editor shown in this tab instead of a
   *  document (src/plugins/): no path, nothing to save - a custom editor's
   *  file is its `resource`, which the plugin reads and writes itself. */
  view?: PluginTabView;
}

// The document part of a tab in flight between windows - what
// start_floating_tab_drag hands to Rust and take_detached_tab /
// receive-detached-tab hand back (tab_drag.rs DetachedTab).
export interface DetachedTabDoc {
  path: string | null;
  content: string;
  savedContent: string;
  diskMtime: number | null;
  helpDoc?: HelpDoc;
  importedFrom?: string;
}

/** A bundled guide's text in `lang`, or in English without a copy in it. */
export function helpDocContent(doc: HelpDoc, lang: string): Promise<string> {
  return (
    HELP_GUIDES.get(`../help/${doc}-guide.${lang}.md`) ??
    HELP_GUIDES.get(`../help/${doc}-guide.en.md`)!
  ).load();
}

// A tab's display name everywhere one is shown (tab pill, title strip,
// detached-drag pill, export default filename).
export function tabTitle(tab: DocTab, t: Strings): string {
  if (tab.path) return basename(tab.path);
  if (tab.view)
    return (
      tab.view.title ??
      (tab.view.resource ? basename(tab.view.resource) : t.untitledTab)
    );
  if (tab.helpDoc === "markdown") return t.markdownGuideTab;
  if (tab.helpDoc === "agent") return t.agentGuideTab;
  if (tab.importedFrom)
    return basename(tab.importedFrom).replace(/\.docx$/i, "");
  if (tab.draftTitle) return tab.draftTitle;
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

/** A new Untitled tab nobody has written in: no file, no Help document,
 *  nothing typed. Something opened here replaces it without losing anything. */
export function tabIsUntouchedDraft(tab: DocTab): boolean {
  return (
    !tab.path &&
    !tab.helpDoc &&
    !tab.view &&
    tab.content === "" &&
    !tabIsDirty(tab)
  );
}

/** A window holding only untouched drafts - what a fresh window shows. Pass
 *  liveTabs(), so an edit still being debounced counts. */
export function windowIsUntouched(tabs: DocTab[]): boolean {
  return tabs.every(tabIsUntouchedDraft);
}

/** The tab `step` places from the active one, in tab-bar order, wrapping
 *  at either end - what Next Tab (1) and Previous Tab (-1) switch to. Null
 *  when there is no other tab to go to. */
export function adjacentTabId(
  tabs: readonly Pick<DocTab, "id">[],
  activeId: string,
  step: 1 | -1,
): string | null {
  if (tabs.length < 2) return null;
  const index = tabs.findIndex((tab) => tab.id === activeId);
  if (index < 0) return tabs[0].id;
  return tabs[(index + step + tabs.length) % tabs.length].id;
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
      path: tab.path,
      content: tab.content,
      savedContent: tab.savedContent,
      diskMtime: tab.diskMtime,
      helpDoc: tab.helpDoc ?? null,
      importedFrom: tab.importedFrom ?? null,
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
