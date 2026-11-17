import type { DocTab } from "./doc-tabs";
import { session } from "../platform/ipc";
import type { DocumentPlace } from "../plugins/app-bridge";
import type { customEditorFor } from "../plugins/store/plugin-lookup";

/** The tab a plugin's custom editor opens `path` in (a PDF, a board). */
export function pluginTab(
  path: string,
  editor: NonNullable<ReturnType<typeof customEditorFor>>,
  target?: DocumentPlace,
): Partial<DocTab> {
  void session.addRecentFile(path);
  return {
    path: null,
    content: "",
    savedContent: "",
    diskMtime: null,
    importedFrom: undefined,
    view: {
      plugin: editor.plugin,
      view: editor.viewType,
      kind: "editor",
      resource: path,
      title: editor.title,
      ...(target ? { target: { path, ...target } } : {}),
    },
  };
}
