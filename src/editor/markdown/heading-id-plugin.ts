import { headingIdGenerator } from "@milkdown/kit/preset/commonmark";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

const isHeading = (node: ProseNode) => node.type.name === "heading";

/** Whether `tr` wrote into a heading, or removed or added one. */
export function touchesHeading(tr: Transaction): boolean {
  let found = false;
  tr.mapping.maps.forEach((map, i) => {
    if (found) return;
    const before = tr.docs[i];
    const after = tr.docs[i + 1] ?? tr.doc;
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (found) return;
      const look = (doc: ProseNode, from: number, to: number) =>
        doc.nodesBetween(from, to, (node) => {
          if (isHeading(node)) found = true;
          return !found && !node.isTextblock;
        });
      look(before, oldStart, oldEnd);
      if (!found) look(after, newStart, newEnd);
    });
  });
  return found;
}

const key = new PluginKey<number>("heading-id");

/**
 * Each heading's `id` (its anchor, for #heading links), as Milkdown's
 * syncHeadingIdPlugin gives it: the id generator's, with "-#2", "-#3" for
 * repeats. That plugin walked the whole document after every change to
 * work them out again; an id only depends on the headings, so here they
 * are worked out again only after a change to one. The state counts those
 * changes; the view syncs when the count moved.
 */
export const headingIdPlugin = $prose((ctx) => {
  const sync = (view: EditorView) => {
    const getId = ctx.get(headingIdGenerator.key);
    const tr = view.state.tr.setMeta("addToHistory", false).setMeta(key, true);
    const seen: Record<string, number> = {};
    let found = false;
    view.state.doc.descendants((node, pos) => {
      if (!isHeading(node)) return !node.isTextblock;
      if (node.textContent.trim().length === 0) return false;
      let id = getId(node);
      if (seen[id]) {
        seen[id] += 1;
        id += `-#${seen[id]}`;
      } else seen[id] = 1;
      if (node.attrs.id !== id) {
        found = true;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
      }
      return false;
    });
    if (found) view.dispatch(tr);
  };
  return new Plugin<number>({
    key,
    state: {
      init: () => 0,
      // Its own id updates don't count.
      apply: (tr, count) =>
        tr.docChanged && !tr.getMeta(key) && touchesHeading(tr)
          ? count + 1
          : count,
    },
    view: (view) => {
      let synced = key.getState(view.state);
      sync(view);
      return {
        update: (view) => {
          const count = key.getState(view.state);
          // Not mid-composition (as Milkdown's): the attr change would
          // redraw the heading under the input method. The first update
          // after it syncs.
          if (count === synced || view.composing) return;
          synced = count;
          sync(view);
        },
      };
    },
  });
});
