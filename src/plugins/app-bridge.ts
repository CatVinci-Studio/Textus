import type { SentBlock } from "../ai/doc-blocks";
import { moveDocumentData } from "./store/document-data";
import type { EditProposal } from "../ai/types";
import type { ChangeSource } from "../editor/change-source";
import type { AppState } from "../platform/ipc-schedule";

/** Where something opens: a tab of its own, beside the front tab, or in its place. */
export type Where = "tab" | "beside" | "current";

/** A place in a file: where to open it, or what a list item, task or search
 *  hit points at. */
export interface PluginLocation {
  path: string;
  line?: number;
  heading?: string;
  block?: string;
  text?: string;
  page?: number;
  fragment?: string;
}

/** A place in the document in front: its path left out. */
export type DocumentPlace = Omit<PluginLocation, "path">;

/** A tab, as a plugin is told of it. */
export interface PluginTabInfo {
  id: string;
  title: string;
  kind: "document" | "file" | "view" | "web";
  path: string | null;
  plugin?: string;
  view?: string;
}

/**
 * What the plugin broker reaches of the window, set by the window itself,
 * so the broker needs no React tree and the window no plugin code.
 */

/** The document in front, as its editor reads it. */
export interface ActiveDocumentAccess {
  path: string | null;
  text(): string;
  /** Its blocks as Textus AI is shown them: what an edit names by `block`. */
  blocks(): SentBlock[];
  /** The selection: its plain text, and as Markdown (null when empty). */
  selection(): { text: string; markdown: string | null };
  /** Shows an edit as a proposal the user accepts or rejects, as Textus
   *  AI's are; false when it can't be placed. */
  propose(callId: string, proposal: EditProposal): boolean;
  /** Makes the edits at once, as one undo step; false when one can't be
   *  placed (then none is made). */
  edit(edits: EditProposal[]): boolean;
  /** Scrolls to a place and puts the caret there; false when not found. */
  reveal(place: DocumentPlace): boolean;
}

/** A document open in a tab, in front or not. */
export interface OpenDocumentAccess {
  text(): string;
  /** Names its version: changes whenever its text does. */
  revision(): string;
  /** Replaces its text, as one undo step, if it is still at `revision`;
   *  false otherwise. */
  replaceText(text: string, revision: string): boolean;
}

/** A tab a plugin's view or custom editor is shown in. */
export interface PluginTabView {
  plugin: string;
  /** A view's id (contributes.views) or a custom editor's viewType. */
  view: string;
  kind: "view" | "list" | "editor" | "web";
  /** The file a custom editor shows; a web page's address. */
  resource?: string;
  title?: string;
  /** What a view was opened with, until it keeps state of its own. */
  state?: unknown;
  /** The place a file editor was opened at, given to it as its target. */
  target?: PluginLocation;
}

export interface WindowAccess {
  /** The folder the sidebar shows, if any. */
  rootPath(): string | null;
  /** Opens a file in a tab - `where` it says - at `place` if given;
   *  `asDocument` opens it as Markdown even where a plugin's editor takes
   *  its type. */
  openFile(
    path: string,
    options: { place?: DocumentPlace; asDocument?: boolean; where?: Where },
  ): void;
  openUntitled(content: string, title?: string, where?: Where): void;
  /** A guide to read: a clean draft, closed without asking; the same guide
   *  already open comes to the front. */
  openGuide(content: string, title: string): void;
  openPluginTab(view: PluginTabView, where?: Where): void;
  /** A document open with unsaved changes, by its path: files.process edits it
   *  in the editor so nothing typed is lost. A saved one is changed on disk. */
  documentAt(path: string): OpenDocumentAccess | null;
  /** The window's tabs, and the one in front. */
  tabs(): PluginTabInfo[];
  activeTab(): PluginTabInfo | null;
}

let activeDocument: ActiveDocumentAccess | null = null;
/** Every document open in a tab, by its path (an editor sets its own). */
const openDocuments = new Map<string, OpenDocumentAccess>();

export function setOpenDocument(
  path: string,
  access: OpenDocumentAccess | null,
  owner?: OpenDocumentAccess,
): void {
  if (access) openDocuments.set(path, access);
  else if (!owner || openDocuments.get(path) === owner)
    openDocuments.delete(path);
}

export function openDocumentAt(path: string): OpenDocumentAccess | null {
  return openDocuments.get(path) ?? null;
}
let windowAccess: WindowAccess | null = null;

/** The active tab's editor sets itself; null when it goes. Only the
 *  current owner can clear it. */
export function setActiveDocument(
  access: ActiveDocumentAccess | null,
  owner?: ActiveDocumentAccess,
): void {
  if (access === null && owner && activeDocument !== owner) return;
  activeDocument = access;
}

export function getActiveDocument(): ActiveDocumentAccess | null {
  return activeDocument;
}

export function setWindowAccess(access: WindowAccess | null): void {
  windowAccess = access;
}

export function getWindowAccess(): WindowAccess | null {
  return windowAccess;
}

/** What plugins can be told of: the event's name and what it carries. */
export interface PluginEventMap {
  /** `trigger`: File › Save (or Save As) is "manual", autosave "auto". */
  didSave: { path: string; text: string; trigger: "manual" | "auto" };
  activeDocument: { path: string | null };
  /** The document in front changed, once typing paused; `source` says who
   *  changed it (the user's wins when several did meanwhile). */
  documentChange: { path: string | null; source: ChangeSource };
  selection: { text: string };
  activeTab: PluginTabInfo | null;
  layout: null;
  root: { path: string | null };
  fileCreate: { path: string };
  fileChange: { path: string };
  fileRename: { from: string; to: string };
  fileDelete: { path: string };
  /** The folder's index (metadata) changed for these documents. */
  metadata: { paths: string[] };
  theme: "light" | "dark";
  language: string;
  /** One of the plugin's own settings changed (told to that plugin only). */
  settings: { key: string; value: unknown };
  /** A key the editor handed the plugin holding the keyboard, to it only. */
  editorKey: string;
  /** A Textus window came to the front, went behind, or the last closed. */
  appState: AppState;
}

type Listener<K extends keyof PluginEventMap> = (
  data: PluginEventMap[K],
) => void;
const listeners = new Map<keyof PluginEventMap, Set<Listener<never>>>();

export function emitPluginEvent<K extends keyof PluginEventMap>(
  name: K,
  data: PluginEventMap[K],
): void {
  for (const listener of listeners.get(name) ?? [])
    (listener as Listener<K>)(data);
}

/** A document or folder was renamed or moved: plugins hear it, and what they
 *  keep for its documents moves with it. */
export async function notePathMoved(from: string, to: string): Promise<void> {
  emitPluginEvent("fileRename", { from, to });
  await moveDocumentData(from, to);
}

/** Whether any plugin listens to `name`: the window skips reading what
 *  nobody will hear (the selection's text on every move). */
export function pluginsListen(name: keyof PluginEventMap): boolean {
  return (listeners.get(name)?.size ?? 0) > 0;
}

/** The broker listens; the returned function stops. */
export function onPluginEvent<K extends keyof PluginEventMap>(
  name: K,
  listener: Listener<K>,
): () => void {
  let set = listeners.get(name);
  if (!set) listeners.set(name, (set = new Set()));
  set.add(listener as Listener<never>);
  return () => set.delete(listener as Listener<never>);
}
