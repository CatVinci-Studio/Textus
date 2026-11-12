import { escapeRegExp } from "../../utils/regexp";

/** One match of the find bar's query, in its editor's positions. */
export interface FindReplaceMatch {
  from: number;
  to: number;
  /** The exact matched text. */
  text: string;
  /** What the query captured where it was found: a regex replacement's
   *  $1, $<name>. */
  groups: (string | undefined)[];
  named?: Record<string, string | undefined>;
}

/** A regex replacement for one match: $1, $<name>, $& and $$ written out
 *  from what was captured where it was found. */
export function expandReplacement(
  replacement: string,
  match: FindReplaceMatch,
): string {
  return replacement.replace(
    /\$(\$|&|<([^>]+)>|\d{1,2})/g,
    (all, token: string, name?: string) => {
      if (token === "$") return "$";
      if (token === "&") return match.text;
      if (name !== undefined) return match.named?.[name] ?? "";
      const n = Number(token);
      return n >= 1 && n < match.groups.length ? (match.groups[n] ?? "") : all;
    },
  );
}

/** The one place a find query becomes a RegExp, so search and replacement
 *  can't drift apart. Null when a regex-mode query doesn't compile. */
export function compileQuery(
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
): RegExp | null {
  try {
    return new RegExp(
      useRegex ? query : escapeRegExp(query),
      `${caseSensitive ? "" : "i"}g`,
    );
  } catch {
    return null;
  }
}

/** Every match of `regex` in `text`, its start and end mapped to the
 *  editor's positions by `at` (an index, and its end one past). */
export function matchesIn(
  text: string,
  regex: RegExp,
  at: (start: number, end: number) => { from: number; to: number },
): FindReplaceMatch[] {
  const found: FindReplaceMatch[] = [];
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    found.push({
      ...at(start, end),
      text: m[0],
      groups: [...m],
      named: m.groups,
    });
    // Zero-width matches would otherwise spin forever.
    regex.lastIndex = end > start ? end : end + 1;
  }
  return found;
}

/** The bar's search as either editor keeps it. */
export interface FindState {
  query: string;
  caseSensitive: boolean;
  useRegex: boolean;
  /** Set when a regex-mode `query` fails to compile; matches is then empty. */
  error: boolean;
  matches: FindReplaceMatch[];
  activeIndex: number;
}

export type FindMeta =
  | { type: "search"; query: string; caseSensitive: boolean; useRegex: boolean }
  | { type: "setActive"; index: number }
  | { type: "clear" };

export const NO_FIND: FindState = {
  query: "",
  caseSensitive: false,
  useRegex: false,
  error: false,
  matches: [],
  activeIndex: -1,
};

type Search = (
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
) => { matches: FindReplaceMatch[]; error: boolean };

/** The search after a change: asked for (`meta`), or the document edited -
 *  results follow edits. The same steps in both editors. */
export function nextFind(
  prev: FindState,
  meta: FindMeta | undefined,
  docChanged: boolean,
  caret: number,
  search: Search,
): FindState {
  if (meta?.type === "clear") return NO_FIND;
  if (meta?.type === "setActive") return { ...prev, activeIndex: meta.index };
  if (meta?.type === "search") {
    const { matches, error } = search(
      meta.query,
      meta.caseSensitive,
      meta.useRegex,
    );
    // The first match from the caret on (wrapping), not the document's first.
    const fromCaret = matches.findIndex((m) => m.from >= caret);
    return {
      query: meta.query,
      caseSensitive: meta.caseSensitive,
      useRegex: meta.useRegex,
      error,
      matches,
      activeIndex: matches.length ? Math.max(fromCaret, 0) : -1,
    };
  }
  if (!docChanged || !prev.query) return prev;
  const { matches, error } = search(
    prev.query,
    prev.caseSensitive,
    prev.useRegex,
  );
  const activeIndex = matches.length
    ? prev.activeIndex < 0
      ? 0
      : Math.min(prev.activeIndex, matches.length - 1)
    : -1;
  return { ...prev, error, matches, activeIndex };
}
