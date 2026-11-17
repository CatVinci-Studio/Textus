import type { Strings } from "../i18n/strings";
import type { DocTab } from "../document/doc-tabs";
import { fs } from "../platform/ipc";
import { toBase64 } from "../plugins/store/files";
import { drawnEditor, htmlPage, runExport } from "./exporters";
import { pluginFormat } from "../registry/plugin-export-formats";

/** File › Export in a plugin's format: the plugin turns the document into
 *  the file's contents, and Textus asks where and writes it. */
export async function exportViaPlugin(
  tab: DocTab,
  key: string,
  t: Strings,
): Promise<void> {
  const format = pluginFormat(key);
  if (!format) return;
  const editor = await drawnEditor(tab, t);
  if (!editor) return;
  await runExport(
    tab,
    t,
    [format.extension, format.label],
    async (picked, base) => {
      const html = await htmlPage(editor, tab, picked, base, {
        images: "inline",
        drawn: "light",
      });
      // tab.content, not the file on disk: unsaved edits export too.
      const out = await format.run({
        markdown: tab.content,
        html,
        path: tab.path,
      });
      if (typeof out === "string") await fs.writeTextFile(picked, out);
      else await fs.writeBase64File(picked, toBase64(out));
    },
  );
}
