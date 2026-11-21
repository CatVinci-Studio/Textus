import { fill } from "../i18n/fill";
import type { Strings } from "../i18n/strings";
import { openedText } from "./tracked-file";
import { folderDocumentAround } from "../files/folder-documents";
import { basename } from "../utils/path";
import { lazyModule } from "../lazy/lazy-module";
import { fs } from "../platform/ipc";
import { detectFormat, toEditorText, toFileText } from "./file-format";
import type { PluginTabView } from "../plugins/app-bridge";
import { chatTitle } from "../ai/chat/chat-title";
import { licensesText } from "../help/licenses";

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
// starts the onboarding tour instead. "licenses" is Settings › About's.
export type HelpDoc = "markdown" | "agent" | "licenses";

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
  /** Pinned: first in its row, narrow, closed only once unpinned. Kept by
   *  path (document/pinned.ts). */
  pinned?: boolean;
  /** A plugin's view or custom editor shown instead of a document; a custom
   *  editor's file is its `resource`, which the plugin saves itself. */
  view?: PluginTabView;
  /** The start page, shown until something opens in this tab. */
  start?: boolean;
  /** Opened by a single click, to look: the next such click shows its file
   *  here instead. Kept once edited or double-clicked. */
  preview?: boolean;
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
  if (doc === "licenses") return licensesText();
  return (
    HELP_GUIDES.get(`../help/${doc}-guide.${lang}.md`) ??
    HELP_GUIDES.get(`../help/${doc}-guide.en.md`)!
  ).load();
}

/** A page tab's name from what it shows now (Settings: its page), given
 *  by the layer that knows the page. */
type PageTitle = (state: unknown, t: Strings) => string | null;
const pageTitles = new Map<string, PageTitle>();

export function namePageTabs(view: string, title: PageTitle): void {
  pageTitles.set(view, title);
}

// A tab's display name everywhere one is shown.
/** What a tab's name leaves out, on hover: an AI tab's conversation. */
export function tabTip(tab: DocTab, t: Strings): string | undefined {
  if (tab.view?.kind === "page" && tab.view.view === "ai")
    return chatTitle(tab.view.title, t);
  // An untitled document by its first line: drafts told apart.
  if (!tab.path && !tab.view) return firstLine(tab.content);
  return undefined;
}

function firstLine(text: string): string | undefined {
  const line = text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:#+|>|[-*+]|\d+[.)])\s+/, "").trim())
    .find(Boolean);
  if (!line) return undefined;
  return line.length > 40 ? `${line.slice(0, 39)}…` : line;
}

export function tabTitle(tab: DocTab, t: Strings): string {
  // A folder opened as one document is named as the folder.
  if (tab.path) return basename(folderDocumentAround(tab.path) ?? tab.path);
  if (showsStartPage(tab)) return t.startPageTab;
  // Textus's own pages, named in the window's language.
  if (tab.view?.kind === "page")
    return tab.view.view === "settings"
      ? (pageTitles.get("settings")?.(tab.view.state, t) ?? t.settingsTitle)
      : tab.view.view === "create"
        ? t.extensionsTabCreate
        : tab.view.view === "ai"
          ? (pageTitles.get("ai")?.(tab.view.state, t) ?? t.agentPanelTitle)
          : tab.view.title
            ? // Told apart from a tab the plugin opens itself, of the same name.
              fill(t.pluginPageTab, { name: tab.view.title })
            : t.extensionsTabPlugins;
  if (tab.view)
    return (
      tab.view.title ??
      (tab.view.resource ? basename(tab.view.resource) : t.untitledTab)
    );
  if (tab.helpDoc === "markdown") return t.markdownGuideTab;
  if (tab.helpDoc === "agent") return t.agentGuideTab;
  if (tab.helpDoc === "licenses") return t.aboutLicenses;
  if (tab.importedFrom)
    return basename(tab.importedFrom).replace(/\.docx$/i, "");
  if (tab.draftTitle) return tab.draftTitle;
  return t.untitledTab;
}

/** A tab showing the start page: opening anything here takes its place. */
export function makeStartTab(): DocTab {
  return { ...makeBlankTab(), start: true };
}

/** Whether `tab` still shows the start page: nothing has opened in it. */
export function showsStartPage(tab: DocTab): boolean {
  return !!tab.start && tabIsUntouchedDraft(tab);
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

/** The user's own unsaved draft: no file, plugin view, guide or Word
 *  import behind it. */
export function isPlainDraft(tab: DocTab): boolean {
  return !tab.path && !tab.view && !tab.helpDoc && !tab.importedFrom;
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

/** Whether a file is on disk; one that can't be read counts as gone. */
export async function fileExists(path: string): Promise<boolean> {
  return (await statMtime(path)) !== null;
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
  // Only a file that isn't there has no format to keep: one that can't be
  // read just now (locked, not downloaded) is not written over as if new,
  // in other line endings.
  const existing = await fs.readTextFile(path).catch(async (error) => {
    if (!(await fileExists(path))) return null;
    // Readable, only not UTF-8 (a GBK text, a file Save As replaces): its
    // line endings from its bytes.
    const bytes = await fs.readBinaryFileBase64(path).catch(() => {
      throw error;
    });
    return atob(bytes);
  });
  const format =
    existing === null ? { crlf: false, bom: false } : detectFormat(existing);
  await fs.writeTextFile(path, toFileText(content, format));
}
