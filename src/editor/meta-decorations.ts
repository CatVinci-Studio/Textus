import type { PluginKey, StateField } from "@milkdown/kit/prose/state";
import { DecorationSet } from "@milkdown/kit/prose/view";

/**
 * A plugin's decorations as its state: a set handed in as `key`'s meta
 * replaces them; otherwise they follow the document's changes.
 */
export function metaDecorations(
  key: PluginKey<DecorationSet>,
): StateField<DecorationSet> {
  return {
    init: () => DecorationSet.empty,
    apply: (tr, set) =>
      (tr.getMeta(key) as DecorationSet | undefined) ??
      set.map(tr.mapping, tr.doc),
  };
}
