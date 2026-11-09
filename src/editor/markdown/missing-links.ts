import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { fs } from "../../platform/ipc";
import { isScopedUrl } from "../../platform/ios-files";
import { windowFolder } from "../../platform/window-folder";
import { FILE_WRITTEN_EVENT, OPEN_FILE_IN_TAB_EVENT } from "../../utils/events";
import { parseNoteLink } from "../../utils/note-link";
import { metaDecorations } from "../meta-decorations";

/**
 * Wikilinks to notes that don't exist yet, dimmed as Obsidian dims them; a
 * click still makes the note. Asked as clicks resolve them, once per name
 * until a file is written or the window comes back.
 */

const key = new PluginKey<DecorationSet>("missing-links");
const WAIT_MS = 300;

/** Whether a link's note exists, by document and name. */
let known = new Map<string, Promise<boolean>>();
const forget = () => {
  known = new Map();
};

function exists(docPath: string, note: string): Promise<boolean> {
  const id = `${docPath}\n${note}`;
  let found = known.get(id);
  if (!found) {
    found = fs.resolveNoteLink(docPath, note, windowFolder(), true).then(
      (t) => t?.exists ?? true,
      () => true,
    );
    known.set(id, found);
  }
  return found;
}

async function missingIn(view: EditorView, docPath: string) {
  const links: { from: number; to: number; note: string }[] = [];
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== "wikilink") return true;
    const note = parseNoteLink(node.textContent)?.note;
    if (note) links.push({ from: pos, to: pos + node.nodeSize, note });
    return false;
  });
  const doc = view.state.doc;
  const found = await Promise.all(links.map((l) => exists(docPath, l.note)));
  if (view.state.doc !== doc) return null;
  return DecorationSet.create(
    doc,
    links
      .filter((_, i) => !found[i])
      .map((l) =>
        Decoration.inline(l.from, l.to, { class: "wikilink-missing" }),
      ),
  );
}

export function createMissingLinksPlugin(docPath: () => string | null) {
  return $prose(
    () =>
      new Plugin<DecorationSet>({
        key,
        state: metaDecorations(key),
        props: { decorations: (state) => key.getState(state) },
        view(view) {
          let timer: ReturnType<typeof setTimeout> | null = null;
          const check = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              const path = docPath();
              if (!path || isScopedUrl(path)) return;
              void missingIn(view, path).then((set) => {
                if (set && !view.isDestroyed)
                  view.dispatch(view.state.tr.setMeta(key, set));
              });
            }, WAIT_MS);
          };
          const again = () => {
            forget();
            check();
          };
          // A click on a missing link makes its note, then opens it.
          const events = [FILE_WRITTEN_EVENT, OPEN_FILE_IN_TAB_EVENT, "focus"];
          events.forEach((name) => window.addEventListener(name, again));
          check();
          return {
            update(next, prev) {
              if (next.state.doc !== prev.doc) check();
            },
            destroy() {
              if (timer) clearTimeout(timer);
              events.forEach((name) => window.removeEventListener(name, again));
            },
          };
        },
      }),
  );
}
