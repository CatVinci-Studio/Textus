import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import {
  compileQuery,
  matchesIn,
  nextFind,
  NO_FIND,
  type FindMeta,
  type FindReplaceMatch,
  type FindState,
} from "./find-query";
import { textWithPositions } from "../text-positions";

interface FindReplaceState extends FindState {
  decorations: DecorationSet;
}

export const findReplaceKey = new PluginKey<FindReplaceState>("find-replace");

/** The query's matches in the document's text, block by block. */
export function computeMatches(
  doc: ProseNode,
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
): { matches: FindReplaceMatch[]; error: boolean } {
  if (!query) return { matches: [], error: false };
  const regex = compileQuery(query, caseSensitive, useRegex);
  if (!regex) return { matches: [], error: true };
  const matches: FindReplaceMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Measured on the block itself: from the document's top, each block
    // would walk every block before it.
    const size = node.content.size;
    const { text, positions } = textWithPositions(node, 0, size);
    // One more entry: the block's end, for a match that reaches it.
    const posMap = [...positions, size].map((p) => pos + 1 + p);
    matches.push(
      ...matchesIn(text, regex, (start, end) => ({
        from: posMap[start],
        // The next character may sit outside an inline enclosure, past
        // node tokens that aren't matched.
        to: end > start ? posMap[end - 1] + 1 : posMap[start],
      })),
    );
    return false;
  });
  return { matches, error: false };
}

function decorated(doc: ProseNode, find: FindState): FindReplaceState {
  const decorations = find.matches.map((match, i) =>
    Decoration.inline(match.from, match.to, {
      class:
        i === find.activeIndex ? "find-match find-match-active" : "find-match",
    }),
  );
  return { ...find, decorations: DecorationSet.create(doc, decorations) };
}

/**
 * Search/highlight engine for the find & replace bar in the rich editor,
 * driven by meta commands; inert until a query is set.
 */
export const findReplacePlugin = $prose(
  () =>
    new Plugin<FindReplaceState>({
      key: findReplaceKey,
      state: {
        init: () => ({ ...NO_FIND, decorations: DecorationSet.empty }),
        apply(tr, prev) {
          const meta = tr.getMeta(findReplaceKey) as FindMeta | undefined;
          const next = nextFind(
            prev,
            meta,
            tr.docChanged,
            tr.selection.from,
            (q, cs, re) => computeMatches(tr.doc, q, cs, re),
          );
          return next === prev ? prev : decorated(tr.doc, next);
        },
      },
      props: {
        decorations(state) {
          return findReplaceKey.getState(state)?.decorations;
        },
      },
    }),
);
