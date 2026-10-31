import type { Strings } from "../i18n/strings";
import { openedText } from "./tracked-file";
import { basename } from "../utils/path";
import { lazyModule } from "../lazy/lazy-module";
import { fs } from "../platform/ipc";
import { detectFormat, toEditorText, toFileText } from "./file-format";
import type { PluginTabView } from "../plugins/app-bridge";

// Every bundled guide, by file name. A language without its own copy gets
// the English one.
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

// The document-tab data model.

// Help doc ids, as the native Help menu sends them. "welcome" isn't one: it
// starts the onboarding tour instead.
export type HelpDoc = "markdown" | "agent";

export interface DocTab {
  id: string;
  path: string | null;
  content: string;
  // What's on disk ("" for a fresh draft); dirtiness is divergence from it.
  savedContent: string;
  // Disk mtime (ms) at the last read or write; null for drafts and unknown.
  // A mismatch means an external change: clean tabs reload, dirty tabs get
  // an overwrite prompt on save.
  diskMtime: number | null;
  sourceMode: boolean;
  /** Source mode with a rendered preview beside it; only meaningful while
   *  sourceMode is on. */
  splitView?: boolean;
  reloadKey: number;
  // A bundled Help document: a pathless draft titled after itself, one tab
  // per doc.
  helpDoc?: HelpDoc;
  /** The Word document this one was made from, until first saved. The Word
   *  file is never written. */
  importedFrom?: string;
  /** A pathless draft's own name instead of "Untitled". */
  draftTitle?: string;
  /** View › Read Only: nothing may change it. Kept by path
   *  (document/read-only.ts). */
  readOnly?: boolean;
  /** A plugin's view or custom editor shown instead of a document; a custom
   *  editor's file is its `resource`, which the plugin saves itself. */
  view?: PluginTabView;
}

// The document part of a tab in flight between windows.
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

// A tab's display name everywhere one is shown.
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

/** A new Untitled tab nobody has written in, so opening something here
 *  loses nothing. */
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

/** The tab `step` places from the active one, wrapping at either end; null
 *  when there is no other tab. */
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

// Shared by both drag flows, so they can't drift apart on which fields
// travel with the document.
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

// Errors count as "no mtime", so change detection degrades instead of
// blocking opens and saves.
export async function statMtime(path: string): Promise<number | null> {
  try {
    return await fs.fileMtimeMs(path);
  } catch {
    return null;
  }
}

/** A document's text as the editor holds it: "\n" line breaks, no BOM. */
export async function readDocText(path: string): Promise<string> {
  return toEditorText(await fs.readTextFile(path));
}

export async function readDocFromDisk(
  path: string,
): Promise<{ content: string; diskMtime: number | null }> {
  const content = await openedText(path, await readDocText(path));
  return { content, diskMtime: await statMtime(path) };
}

/** Writes a document in the line endings and BOM the file has on disk,
 *  read at save time so it holds however the tab got here. */
export async function writeDocFile(
  path: string,
  content: string,
): Promise<void> {
  const existing = await fs.readTextFile(path).catch(() => null);
  const format =
    existing === null ? { crlf: false, bom: false } : detectFormat(existing);
  await fs.writeTextFile(path, toFileText(content, format));
}
