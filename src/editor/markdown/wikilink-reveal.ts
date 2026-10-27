import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import {
  applyReveal,
  revealAll,
  type Reveal,
  type RevealState,
} from "../reveal-state";

const key = new PluginKey<RevealState>("wikilink-reveal");

const isWikilink = (node: ProseNode) => node.type.name === "wikilink";

/** The source a wikilink hides while the caret is away, as offsets in its
 *  text: "[[" (with "Note|" before an alias) and "]]". Null when it isn't
 *  one whole. */
export function hiddenParts(text: string): [number, number][] | null {
  if (!text.startsWith("[[") || !text.endsWith("]]") || text.length < 5)
    return null;
  const bar = text.indexOf("|");
  const open = bar > 2 && bar < text.length - 3 ? bar + 1 : 2;
  return [
    [0, open],
    [text.length - 2, text.length],
  ];
}

const reveal: Reveal = {
  match: isWikilink,
  decorate(node, pos, touches) {
    const parts = hiddenParts(node.textContent);
    if (!parts || touches(pos, pos + node.nodeSize)) return [];
    return parts.map(([from, to]) =>
      Decoration.inline(pos + 1 + from, pos + 1 + to, {
        class: "wikilink-source-hidden",
      }),
    );
  },
};

/** A wikilink reads as its name, as in Obsidian; its brackets show while
 *  the caret is on it. */
export const wikilinkRevealPlugin = $prose(
  () =>
    new Plugin<RevealState>({
      key,
      state: {
        init: (_config, state) => revealAll(state, reveal),
        apply: (tr, prev, oldState, newState) =>
          applyReveal(tr, prev, oldState, newState, reveal),
      },
      props: {
        decorations: (state) => key.getState(state)?.set,
      },
    }),
);
