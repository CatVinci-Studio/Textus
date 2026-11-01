import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

/** The part of the document a paper is being written into. */
export interface PaperRegion {
  from: number;
  to: number;
}

const paperRegionKey = new PluginKey<PaperRegion | null>("paper-region");

/** Where the paper being written is now, mapped through every edit since
 *  it was last written; null while none is. */
export function paperRegion(state: EditorState): PaperRegion | null {
  return paperRegionKey.getState(state) ?? null;
}

/** Marks where the paper now is, or that none is being written. */
export function setPaperRegion(
  tr: Transaction,
  region: PaperRegion | null,
): Transaction {
  return tr.setMeta(paperRegionKey, region);
}

/** Whether `tr` changes anything inside `region`, as it stood before. */
function touches(tr: Transaction, region: PaperRegion): boolean {
  let { from, to } = region;
  for (const map of tr.mapping.maps) {
    let inside = false;
    map.forEach((start, end) => {
      if (start < to && end > from) inside = true;
    });
    if (inside) return true;
    from = map.map(from, 1);
    to = Math.max(from, map.map(to, -1));
  }
  return false;
}

/**
 * Follows the paper's place while the user edits around it, so each write
 * replaces the paper and nothing else (usePaperDocument). Inside it, the
 * paper is the writer's until it settles: an edit there would be written
 * over a moment later, so it is refused. Nothing at all while no paper is
 * being written.
 */
export const paperRegionPlugin = $prose(
  () =>
    new Plugin<PaperRegion | null>({
      key: paperRegionKey,
      filterTransaction(tr, state) {
        const region = paperRegionKey.getState(state);
        if (!region || !tr.docChanged) return true;
        // The writer's own steps say where the paper is now.
        if (tr.getMeta(paperRegionKey) !== undefined) return true;
        return !touches(tr, region);
      },
      state: {
        init: () => null,
        apply(tr, region) {
          const set = tr.getMeta(paperRegionKey) as
            PaperRegion | null | undefined;
          if (set !== undefined) return set;
          if (!region || !tr.docChanged) return region;
          // Typing just before or after it stays out of it.
          const from = tr.mapping.map(region.from, 1);
          const to = Math.max(from, tr.mapping.map(region.to, -1));
          return { from, to };
        },
      },
    }),
);
