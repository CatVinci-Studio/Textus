import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";

/** Monotonic within one mounted editor, including Undo and Redo. */
export const documentRevisionKey = new PluginKey<number>("document-revision");
export const documentRevisionPlugin = $prose(
  () =>
    new Plugin({
      key: documentRevisionKey,
      state: {
        init: () => 0,
        apply: (tr, revision) => (tr.docChanged ? revision + 1 : revision),
      },
    }),
);
