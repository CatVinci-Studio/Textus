import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { undoFiles } from "../platform/ipc-files";
import { fnv1a } from "../utils/hash";
import {
  leaveHistory,
  readHistory,
  takeHistory,
  writeHistory,
} from "./left-history";
import { openedFromCtx } from "./opened-from";

// A document's undo history outlives its tab, like Vim's undofile: written
// as its editor goes, and taken as it stands (left-history.ts) when the
// document is opened at the same text again.

/** What the text is known by: the history is used only at this text.
 *  Hashed as the tree is walked, never copied whole: it runs as each tab
 *  comes to the front and leaves. */
export function docHash(doc: ProseNode): string {
  let h = fnv1a("doc");
  const feed = (part: string) => (h = fnv1a(part + "\u0000", h));
  const attrs = (a: object) => {
    if (Object.keys(a).length > 0) feed(JSON.stringify(a));
  };
  doc.descendants((node) => {
    feed(node.type.name + "/" + node.childCount);
    attrs(node.attrs);
    if (node.text) feed(node.text);
    for (const mark of node.marks) {
      feed(mark.type.name);
      attrs(mark.attrs);
    }
  });
  return h.toString(36);
}

const undoFileKey = new PluginKey("undo-file");

/** Keeps the document's undo history when its editor goes, and gives it
 *  back when it opens at the same text. Nothing for a draft with no file. */
export function createUndoFilePlugin(docPath: () => string | null) {
  return $prose(
    (ctx) =>
      new Plugin({
        key: undoFileKey,
        view(view) {
          const path = docPath();
          const opened = view.state.doc;
          // The tab's last editor left its history here already.
          if (path && !ctx.get(openedFromCtx.key))
            void undoFiles
              .load(path, docHash(opened))
              .then((kept) => {
                // Only before anything has happened here.
                const left = kept && readHistory(kept);
                if (!left || view.isDestroyed || view.state.doc !== opened)
                  return;
                const tr = takeHistory(view.state, left);
                if (tr) view.dispatch(tr);
              })
              .catch((err: unknown) => console.error("[undo-file] read:", err));
          return {
            destroy() {
              const at = docPath();
              const left = leaveHistory(view.state);
              if (!at || !left) return;
              void undoFiles
                .save(at, docHash(view.state.doc), writeHistory(left))
                .catch((err: unknown) =>
                  console.error("[undo-file] save:", err),
                );
            },
          };
        },
      }),
  );
}
