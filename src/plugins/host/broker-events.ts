import { onNotesChanged } from "../../ai/margin/notes-by-path";
import {
  emitPluginEvent,
  getWindowAccess,
  onPluginEvent,
  type PluginEventMap,
  type PluginTabInfo,
} from "../app-bridge";
import type { Permission } from "../store/manifest";
import { inOpenFolder } from "../may-open";
import { absoluteIn } from "../../utils/path";
import { seenBy } from "./broker-layout";

/**
 * The window's events as a plugin may hear them: which permission each
 * needs, and what of each it is told.
 */

/** Events about one file (or a move), told only to a plugin that can read
 *  it: in the window's folder, not in a hidden folder of it. */
const FILE_EVENTS = new Set<keyof PluginEventMap>([
  "didSave",
  "fileCreate",
  "fileChange",
  "fileChangeOnDisk",
  "comments",
  "fileRename",
  "fileDelete",
]);

// Margin notes are written by the editor or a plugin; plugins hear of both.
onNotesChanged((path) => emitPluginEvent("comments", { path }));

/** Whether the files a file event is about are ones plugins read. */
export function fileEventReadable(data: unknown, root: string | null): boolean {
  if (!root || typeof data !== "object" || data === null) return false;
  const paths = ["path", "from", "to"]
    .map((key) => (data as Record<string, unknown>)[key])
    .filter((path): path is string => typeof path === "string");
  return paths.some((path) => inOpenFolder(root, absoluteIn(root, path)));
}

/** The events that keep a plugin's `textus.env` current. */
export const ENV_EVENTS = ["language", "theme", "appState"] as const;

/** The events a plugin can listen to, and the permission each needs.
 *  `settings` and `editorKey` are told to one plugin only. */
const PLUGIN_EVENT_NEEDS: Record<keyof PluginEventMap, Permission | null> = {
  didSave: "files.read",
  activeDocument: "editor.read",
  documentChange: "editor.read",
  selection: "editor.read",
  visible: "editor.read",
  copy: "clipboard",
  activeTab: null,
  layout: null,
  root: "files.read",
  conventions: "files.read",
  fileCreate: "files.read",
  fileChange: "files.read",
  fileChangeOnDisk: "files.read",
  comments: "comments",
  fileRename: "files.read",
  fileDelete: "files.read",
  metadata: "files.read",
  theme: null,
  appearance: null,
  language: null,
  settings: null,
  editorKey: "editor.input",
  appState: null,
  aiState: null,
  panels: null,
  activity: null,
  floating: null,
  floatingTouch: null,
};

/** The permission plugins need to hear `name`; throws for no such event. */
export function eventNeeds(name: string): Permission | null {
  if (!(name in PLUGIN_EVENT_NEEDS)) throw new Error(`No event ${name}.`);
  return PLUGIN_EVENT_NEEDS[name as keyof PluginEventMap];
}

/** Starts telling `plugin` the window's `event`, as much of it as is its
 *  to hear; returns the stop. */
export function listenFor(
  event: keyof PluginEventMap,
  plugin: {
    id: string;
    granted: readonly Permission[];
    tell: <K extends keyof PluginEventMap>(
      name: K,
      data: PluginEventMap[K],
    ) => void;
  },
): () => void {
  // Told to one plugin only, by whoever has it.
  if (event === "settings" || event === "editorKey") return () => {};
  if (event === "floating" || event === "floatingTouch")
    return onPluginEvent(event, (data) => {
      if (data.plugin === plugin.id) plugin.tell(event, data);
    });
  if (FILE_EVENTS.has(event))
    return onPluginEvent(event, (data) => {
      const root = getWindowAccess()?.rootPath() ?? null;
      if (fileEventReadable(data, root)) plugin.tell(event, data);
    });
  if (event === "activeTab")
    return onPluginEvent(event, (data) =>
      plugin.tell(
        event,
        seenBy(plugin.id, plugin.granted, data as PluginTabInfo),
      ),
    );
  return onPluginEvent(event, (data) => plugin.tell(event, data));
}
