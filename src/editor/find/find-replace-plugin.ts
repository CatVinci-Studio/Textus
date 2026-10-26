import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { escapeRegExp } from "../../utils/regexp";

export const findReplaceKey = new PluginKey<FindReplaceState>("find-replace");

export interface FindReplaceMatch {
  from: number;
  to: number;
  /** The exact matched text, so regex-mode replace can re-run capture groups. */
  text: string;
}

export interface FindReplaceState {
  query: string;
  caseSensitive: boolean;
  useRegex: boolean;
  /** Set when a regex-mode `query` fails to compile; matches is then empty. */
  error: boolean;
  matches: FindReplaceMatch[];
  activeIndex: number;
  decorations: DecorationSet;
}

type FindReplaceMeta =
  | { type: "search"; query: string; caseSensitive: boolean; useRegex: boolean }
  | { type: "setActive"; index: number }
  | { type: "clear" };

/**
 * The one place a find query becomes a RegExp, so search and replacement
 * can't drift apart. Null when a regex-mode query doesn't compile.
 */
export function compileQuery(
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
  global = true,
): RegExp | null {
  try {
    return new RegExp(
      useRegex ? query : escapeRegExp(query),
      `${caseSensitive ? "" : "i"}${global ? "g" : ""}`,
    );
  } catch {
    return null;
  }
}

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
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      matches.push({
        from: posMap[start],
        // The next character may sit outside an inline enclosure, past node tokens
        // that aren't matched.
        to: end > start ? posMap[end - 1] + 1 : posMap[start],
        text: m[0],
      });
      // Zero-width matches would otherwise spin forever.
      regex.lastIndex = end > start ? end : end + 1;
    }
    return false;
  });

  return { matches, error: false };
}

function buildDecorations(
  doc: ProseNode,
  matches: FindReplaceMatch[],
  activeIndex: number,
): DecorationSet {
  const decorations = matches.map((match, i) =>
    Decoration.inline(match.from, match.to, {
      class: i === activeIndex ? "find-match find-match-active" : "find-match",
    }),
  );
  return DecorationSet.create(doc, decorations);
}

const EMPTY_STATE: FindReplaceState = {
  query: "",
  caseSensitive: false,
  useRegex: false,
  error: false,
  matches: [],
  activeIndex: -1,
  decorations: DecorationSet.empty,
};

/**
 * Search/highlight engine for the find & replace bar, driven by meta
 * commands; inert until a query is set.
 */
export const findReplacePlugin = $prose(
  () =>
    new Plugin<FindReplaceState>({
      key: findReplaceKey,
      state: {
        init: () => EMPTY_STATE,
        apply(tr, prev) {
          const meta = tr.getMeta(findReplaceKey) as
            FindReplaceMeta | undefined;

          if (meta?.type === "clear") return EMPTY_STATE;

          if (meta?.type === "search") {
            const { matches, error } = computeMatches(
              tr.doc,
              meta.query,
              meta.caseSensitive,
              meta.useRegex,
            );
            // The first match from the caret on (wrapping), not the document's first.
            const caret = tr.selection.from;
            const fromCaret = matches.findIndex((m) => m.from >= caret);
            const activeIndex = matches.length ? Math.max(fromCaret, 0) : -1;
            return {
              query: meta.query,
              caseSensitive: meta.caseSensitive,
              useRegex: meta.useRegex,
              error,
              matches,
              activeIndex,
              decorations: buildDecorations(tr.doc, matches, activeIndex),
            };
          }

          if (meta?.type === "setActive") {
            return {
              ...prev,
              activeIndex: meta.index,
              decorations: buildDecorations(tr.doc, prev.matches, meta.index),
            };
          }

          if (!tr.docChanged || !prev.query) return prev;

          // Live re-search, so results follow edits.
          const { matches, error } = computeMatches(
            tr.doc,
            prev.query,
            prev.caseSensitive,
            prev.useRegex,
          );
          const activeIndex = matches.length
            ? prev.activeIndex < 0
              ? 0
              : Math.min(prev.activeIndex, matches.length - 1)
            : -1;
          return {
            ...prev,
            error,
            matches,
            activeIndex,
            decorations: buildDecorations(tr.doc, matches, activeIndex),
          };
        },
      },
      props: {
        decorations(state) {
          return findReplaceKey.getState(state)?.decorations;
        },
      },
    }),
);
