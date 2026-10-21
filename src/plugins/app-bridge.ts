import type { EditProposal } from "../ai/types";

/**
 * What the plugin broker reaches of the window, set by the window itself:
 * the document in front (by its editor, while it is the active tab), the
 * window's ways to open things, and the events plugins may listen to.
 * Kept here so the broker needs no React tree, and the window no plugin
 * code.
 */

/** The document in front, as its editor reads it. */
export interface ActiveDocumentAccess {
  path: string | null;
  /** Its Markdown. */
  text(): string;
  /** The selection: its plain text, and as Markdown (null when empty). */
  selection(): { text: string; markdown: string | null };
  /** Shows an edit as a proposal the user accepts or rejects, as Textus
   *  AI's are; false when it can't be placed. */
  propose(callId: string, proposal: EditProposal): boolean;
}

/** A tab a plugin's view or custom editor is shown in (DocTab.view). */
export interface PluginTabView {
  plugin: string;
  /** A view's id (contributes.views) or a custom editor's viewType. */
  view: string;
  kind: "view" | "editor" | "web";
  /** The file a custom editor shows; a web page's address. */
  resource?: string;
  title?: string;
  /** What a view was opened with (window.openView's `state`), until it
   *  keeps state of its own. */
  state?: unknown;
}

/** The window's side. */
export interface WindowAccess {
  /** The folder the sidebar shows, if any. */
  rootPath(): string | null;
  /** Opens a document in a tab, at `heading` if given. */
  openFile(path: string, heading?: string): void;
  openUntitled(content: string, title?: string): void;
  openPluginTab(view: PluginTabView): void;
}

let activeDocument: ActiveDocumentAccess | null = null;
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

/** What plugins can be told of (textus.workspace.onDidSaveDocument and
 *  the like): the event's name and what it carries. */
export interface PluginEventMap {
  didSave: { path: string; text: string };
  activeDocument: { path: string | null };
  root: { path: string | null };
  theme: "light" | "dark";
  language: string;
  /** One of the plugin's own settings changed (told to that plugin only). */
  settings: { key: string; value: unknown };
}

type Listener<K extends keyof PluginEventMap> = (data: PluginEventMap[K]) => void;
const listeners = new Map<keyof PluginEventMap, Set<Listener<never>>>();

/** The window tells plugins something happened. */
export function emitPluginEvent<K extends keyof PluginEventMap>(
  name: K,
  data: PluginEventMap[K],
): void {
  for (const listener of listeners.get(name) ?? [])
    (listener as Listener<K>)(data);
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
