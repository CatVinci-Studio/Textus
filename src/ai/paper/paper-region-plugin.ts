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

/**
 * Follows the paper's place while the user edits around it, so each write
 * replaces the paper and nothing else (usePaperDocument). Two numbers mapped
 * per transaction, and nothing at all while no paper is being written.
 */
export const paperRegionPlugin = $prose(
  () =>
    new Plugin<PaperRegion | null>({
      key: paperRegionKey,
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
