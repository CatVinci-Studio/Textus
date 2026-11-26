import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { fs } from "../../platform/ipc";
import type { SingleNewlineMode } from "../../prefs/settings-values";

/** On the editor while one newline in a paragraph breaks the line: the
 *  newline's node is drawn as a break (editor-inline.css), the text is
 *  never changed. HTML and PDF export copy the editor, attribute and all. */
export const LINE_BREAKS_ATTR = "data-line-breaks";

/** Whether one newline in a paragraph breaks the line: the folder's own
 *  convention (an Obsidian vault's "Strict line breaks"), else the setting. */
export const showsLineBreaks = (
  folder: boolean | null | undefined,
  setting: SingleNewlineMode,
): boolean => folder ?? setting === "break";

/** What the document's folder says, or null where it says nothing. */
export async function folderLineBreaks(
  docPath: string | null,
): Promise<boolean | null> {
  if (!docPath) return null;
  try {
    return (await fs.folderConventions(docPath)).softBreaks?.value ?? null;
  } catch {
    return null;
  }
}

const key = new PluginKey<boolean | null>("line-breaks");

interface LineBreaksOptions {
  setting: () => SingleNewlineMode;
  docPath: () => string | null;
}

/** The editor's attribute by the setting and its document's folder, read
 *  again when the document moves (Save As, a first save); a transaction
 *  draws a changed setting (useSettingsRedraw). */
export function lineBreaksPlugin(options: LineBreaksOptions) {
  return new Plugin<boolean | null>({
    key,
    state: {
      init: () => null,
      apply: (tr, folder) => {
        const said = tr.getMeta(key) as boolean | null | undefined;
        return said === undefined ? folder : said;
      },
    },
    props: {
      attributes: (state): Record<string, string> =>
        showsLineBreaks(key.getState(state), options.setting())
          ? { [LINE_BREAKS_ATTR]: "" }
          : {},
    },
    view: (view) => {
      let path: string | null = null;
      const read = () => {
        const asked = (path = options.docPath());
        void folderLineBreaks(asked).then((said) => {
          if (view.isDestroyed || asked !== path) return;
          if (said === key.getState(view.state)) return;
          view.dispatch(
            view.state.tr.setMeta(key, said).setMeta("addToHistory", false),
          );
        });
      };
      read();
      return {
        update: () => {
          if (options.docPath() !== path) read();
        },
      };
    },
  });
}

export const createLineBreaksPlugin = (options: LineBreaksOptions) =>
  $prose(() => lineBreaksPlugin(options));
