/**
 * A code language a plugin declares as data: an ordered list of rules, each
 * a regular expression and the kind of token it marks. One line is read at
 * a time; at each place the first rule that matches there takes it, and
 * where none does one character stays plain. The rich editor and source
 * mode both read lines through `tokenizeLine`, so they colour alike.
 */

/** A rule's kind -> the Prism class the rich editor's stylesheet and themes
 *  colour, and the highlight tag source mode's style colours. */
export const TOKEN_TYPES = {
  comment: { prism: "comment", tag: "comment" },
  string: { prism: "string", tag: "string" },
  number: { prism: "number", tag: "number" },
  constant: { prism: "constant", tag: "bool" },
  keyword: { prism: "keyword", tag: "keyword" },
  operator: { prism: "operator", tag: "operator" },
  function: { prism: "function", tag: "variableName.function" },
  type: { prism: "class-name", tag: "className" },
  tag: { prism: "tag", tag: "tagName" },
  attribute: { prism: "attr-name", tag: "attributeName" },
  punctuation: { prism: "punctuation", tag: "punctuation" },
} as const;
export type TokenType = keyof typeof TOKEN_TYPES;

interface GrammarRule {
  type: TokenType;
  /** Sticky: matched at one place of the whole line, so `^` and `\b` keep
   *  their meaning. */
  pattern: RegExp;
}

export interface Grammar {
  rules: GrammarRule[];
}

export interface Token {
  from: number;
  to: number;
  type: TokenType;
}

/** A regular expression can't be stopped once it runs, so the guards keep
 *  the slow kinds out instead: longer lines stay plain, patterns are short
 *  and few, and those that can backtrack without end are refused. */
export const LINE_LIMIT = 500;
const PATTERN_LIMIT = 1000;
const RULE_LIMIT = 200;

const isTokenType = (type: unknown): type is TokenType =>
  typeof type === "string" && Object.hasOwn(TOKEN_TYPES, type);

/** Why `source` could run for ever on a long enough line, or null. A
 *  group repeated without bound may hold no repeat and no `|` (the
 *  `(a+)+` kind); backreferences can't be bounded either. Lookbehind is
 *  refused as Safari before 16.4 can't compile it. */
export function unsafePattern(source: string): string | null {
  if (/\\[1-9]|\\k</.test(source)) return "a backreference";
  if (/\(\?<[=!]/.test(source)) return "a lookbehind";
  const open: boolean[] = [];
  const mark = () => {
    if (open.length) open[open.length - 1] = true;
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") i++;
    else if (c === "[") {
      // A class: nothing in it repeats. A `]` first in it is literal.
      i += source[i + 1] === "^" ? 2 : 1;
      if (source[i] === "]") i++;
      while (i < source.length && source[i] !== "]")
        i += source[i] === "\\" ? 2 : 1;
    } else if (c === "(") open.push(false);
    else if (c === ")") {
      const repeats = open.pop();
      if (repeats && /^(?:[*+]|\{\d+,\})/.test(source.slice(i + 1)))
        return "a group repeated without bound that repeats inside";
      if (repeats) mark();
    } else if (c === "|") mark();
    else if (c === "*" || c === "+") mark();
    // `?` after a quantifier only makes it lazy; after `(` it starts `(?:`.
    else if (c === "?" && source[i - 1] !== "(") mark();
    else if (c === "{" && /^\{\d+(?:,\d*)?\}/.test(source.slice(i))) mark();
  }
  return null;
}

function compileRule(rule: unknown, flags: string): GrammarRule | string {
  if (!rule || typeof rule !== "object") return "isn't an object";
  const { token, match, flags: own } = rule as Record<string, unknown>;
  if (!isTokenType(token)) return `token "${String(token)}" isn't one of ours`;
  if (typeof match !== "string" || !match) return "has no match";
  if (match.length > PATTERN_LIMIT) return "match is too long";
  const unsafe = unsafePattern(match);
  if (unsafe) return `match has ${unsafe}`;
  const kept = [...new Set(typeof own === "string" ? own : flags)]
    .filter((f) => f === "i" || f === "u")
    .join("");
  try {
    return { type: token, pattern: new RegExp(match, `${kept}y`) };
  } catch {
    return "match isn't a regular expression";
  }
}

/** The grammar in a plugin's JSON file. A rule Textus can't use is left
 *  out and said in `problems`; the others still colour. */
export function compileGrammar(json: unknown): {
  grammar: Grammar;
  problems: string[];
} {
  const problems: string[] = [];
  const file = (json && typeof json === "object" ? json : {}) as Record<
    string,
    unknown
  >;
  const flags = typeof file.flags === "string" ? file.flags : "";
  const listed = Array.isArray(file.rules) ? file.rules : [];
  if (!Array.isArray(file.rules)) problems.push("rules isn't a list");
  if (listed.length > RULE_LIMIT)
    problems.push(`only the first ${RULE_LIMIT} rules are read`);
  const rules: GrammarRule[] = [];
  listed.slice(0, RULE_LIMIT).forEach((rule, i) => {
    const compiled = compileRule(rule, flags);
    if (typeof compiled === "string") problems.push(`rules[${i}] ${compiled}`);
    else rules.push(compiled);
  });
  return { grammar: { rules }, problems };
}

/** The rule matching at `pos` of `line`, and where its match ends; a match
 *  of nothing doesn't count, or the reading would never move on. */
export function matchAt(
  grammar: Grammar,
  line: string,
  pos: number,
): { end: number; type: TokenType } | null {
  for (const { pattern, type } of grammar.rules) {
    pattern.lastIndex = pos;
    const m = pattern.exec(line);
    if (m && m[0].length) return { end: pos + m[0].length, type };
  }
  return null;
}

/** One line's tokens, offsets into it; none for a line past LINE_LIMIT. */
export function tokenizeLine(grammar: Grammar, line: string): Token[] {
  const out: Token[] = [];
  if (line.length > LINE_LIMIT || !grammar.rules.length) return out;
  let pos = 0;
  while (pos < line.length) {
    const hit = matchAt(grammar, line, pos);
    if (!hit) {
      pos++;
      continue;
    }
    out.push({ from: pos, to: hit.end, type: hit.type });
    pos = hit.end;
  }
  return out;
}

/** One line may take this long, and a whole block this long, before the
 *  grammar counts as too slow: a long configuration of ordinary lines
 *  reads in a few milliseconds. */
const LINE_BUDGET_MS = 20;
const BLOCK_BUDGET_MS = 500;

/** A block's tokens, offsets into `text`, or null once a line or the
 *  block has taken too long: the grammar is too slow to keep using. */
export function tokenizeBlock(
  grammar: Grammar,
  text: string,
  now: () => number = () => performance.now(),
): Token[] | null {
  const out: Token[] = [];
  const start = now();
  let lineStart = start;
  let offset = 0;
  for (const line of text.split("\n")) {
    for (const token of tokenizeLine(grammar, line))
      out.push({
        from: offset + token.from,
        to: offset + token.to,
        type: token.type,
      });
    offset += line.length + 1;
    const at = now();
    if (at - lineStart > LINE_BUDGET_MS || at - start > BLOCK_BUDGET_MS)
      return null;
    lineStart = at;
  }
  return out;
}
