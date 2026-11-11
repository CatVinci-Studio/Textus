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

interface FindReplaceState extends FindState {
  decorations: DecorationSet;
}

export const findReplaceKey = new PluginKey<FindReplaceState>("find-replace");

/**
 * Flattens a textblock's inline content, nested enclosures included, into a
 * string plus a map from each character index to its doc position (one extra
 * entry for the end).
 */
function textblockCharMap(
  node: ProseNode,
  contentStart: number,
): { text: string; posMap: number[] } {
  let text = "";
  const posMap: number[] = [];
  node.descendants((child, offset) => {
    if (!child.isText || !child.text) return;
    const base = contentStart + offset;
    for (let i = 0; i < child.text.length; i++) posMap.push(base + i);
    text += child.text;
  });
  posMap.push(contentStart + node.content.size);
  return { text, posMap };
}

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
    const { text, posMap } = textblockCharMap(node, pos + 1);
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
