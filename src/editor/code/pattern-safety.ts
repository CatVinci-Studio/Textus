/**
 * Whether a code language's regular expression could run for ever on a
 * long line. A regular expression can't be stopped once it runs, so the
 * slow kinds are kept out before it ever does: what makes one slow is a
 * stretch of text that several repeats in turn could each take - every
 * way of sharing it out is tried before the match gives up. Two such
 * repeats cost little on a 500-character line; three, or a repeat of a
 * group that can match one text more than one way, can take seconds.
 */

/** One character's worth of pattern: a literal, an escape, a class, `.`. */
type Atom = { t: "atom"; src: string };
type Node =
  | Atom
  /** Matches no text: `^`, `$`, `\b`, `\B`. */
  | { t: "zero" }
  /** A lookahead: no text either, but tried again each time what comes
   *  before it gives back a character. */
  | { t: "ahead"; branches: Node[][] }
  | { t: "group"; branches: Node[][] }
  | { t: "quant"; node: Node; min: number; max: number };

class Refused extends Error {}

/** At most this many repeats and choices in one pattern. */
const CHOICE_LIMIT = 16;
/** At most this many repeats may take the same characters in turn. */
const TURN_LIMIT = 2;

/** The characters each atom is tried on to tell whether two can match the
 *  same one: ASCII, and a few that case or Unicode classes treat apart. */
const PROBES = [
  ...Array.from({ length: 128 }, (_, i) => String.fromCharCode(i)),
  ..."éÉßſK中  ﻿",
];

type CharSet = boolean[];
const ALL: CharSet = PROBES.map(() => true);

function parse(source: string): Node[][] {
  let i = 0;
  const atom = (src: string): Atom => ({ t: "atom", src });

  const escape = (): Node => {
    const start = i;
    const c = source[i + 1];
    i += 2;
    if (c === "b" || c === "B") return { t: "zero" };
    if (c === undefined) throw new Refused("a pattern it can't read");
    if (c === "x") i += 2;
    else if (c === "c") i += 1;
    else if ((c === "u" || c === "p" || c === "P") && source[i] === "{")
      i = source.indexOf("}", i) + 1 || source.length;
    else if (c === "u") i += 4;
    return atom(source.slice(start, i));
  };

  const charClass = (): Atom => {
    const start = i;
    i += source[i + 1] === "^" ? 2 : 1;
    while (i < source.length && source[i] !== "]")
      i += source[i] === "\\" ? 2 : 1;
    i++;
    return atom(source.slice(start, i));
  };

  const term = (): Node => {
    const c = source[i];
    if (c === "(") {
      const ahead = source.startsWith("(?=", i) || source.startsWith("(?!", i);
      if (ahead || source.startsWith("(?:", i)) i += 3;
      else if (source.startsWith("(?<", i))
        i = source.indexOf(">", i) + 1 || source.length;
      else i++;
      const branches = alternatives();
      if (source[i] !== ")") throw new Refused("a pattern it can't read");
      i++;
      return { t: ahead ? "ahead" : "group", branches };
    }
    if (c === "[") return charClass();
    if (c === "\\") return escape();
    i++;
    return c === "^" || c === "$" ? { t: "zero" } : atom(c!);
  };

  const quantified = (node: Node): Node => {
    const c = source[i];
    let min: number;
    let max: number;
    const braces = /^\{(\d+)(?:(,)(\d*))?\}/.exec(source.slice(i));
    if (c === "*" || c === "+" || c === "?") {
      [min, max] =
        c === "*" ? [0, Infinity] : c === "+" ? [1, Infinity] : [0, 1];
      i++;
    } else if (braces) {
      min = Number(braces[1]);
      max = !braces[2] ? min : braces[3] ? Number(braces[3]) : Infinity;
      i += braces[0].length;
    } else return node;
    if (source[i] === "?") i++;
    return node.t === "zero" || node.t === "ahead"
      ? node
      : { t: "quant", node, min, max };
  };

  function alternatives(): Node[][] {
    const branches: Node[][] = [[]];
    while (i < source.length && source[i] !== ")") {
      if (source[i] === "|") {
        i++;
        branches.push([]);
      } else branches[branches.length - 1]!.push(quantified(term()));
    }
    return branches;
  }

  const top = alternatives();
  if (i < source.length) throw new Refused("a pattern it can't read");
  return top;
}

let flagsNow = "";
const sets = new Map<string, CharSet>();

/** Beyond what the probes can tell apart: a character past ASCII, or an
 *  escape naming one or a Unicode class. */
const PAST_PROBES = /[^ -~\t\n\r]|\\[uUpP]|\\x[89a-fA-F]/;

/** The probe characters `src` matches, under the rule's flags; all of
 *  them where the probes can't tell, so it overlaps everything. */
function setOf(src: string): CharSet {
  const key = `${flagsNow}/${src}`;
  let set = sets.get(key);
  if (!set) {
    try {
      const re = new RegExp(`^(?:${src})$`, flagsNow);
      set = PROBES.map((ch) => re.test(ch));
    } catch {
      set = ALL;
    }
    if (PAST_PROBES.test(src) || !set.some(Boolean)) set = ALL;
    sets.set(key, set);
  }
  return set;
}

const overlap = (a: CharSet, b: CharSet) => a.some((x, k) => x && b[k]);
const union = (sets: CharSet[]) =>
  PROBES.map((_, k) => sets.some((set) => set[k]));

/** Every character a node can take. */
function setIn(node: Node): CharSet {
  if (node.t === "atom") return setOf(node.src);
  if (node.t === "quant") return setIn(node.node);
  if (node.t === "zero" || node.t === "ahead") return PROBES.map(() => false);
  return union(node.branches.flat().map(setIn));
}

/** The atom a branch starts with, if it is one fixed length of atoms. */
function fixedStart(branch: Node[]): Atom | null {
  let first: Atom | null = null;
  for (const node of branch) {
    const one = node.t === "quant" && node.min === node.max ? node.node : node;
    if (one.t === "zero") continue;
    // Tried again each time over: not one way.
    if (one.t === "ahead") return null;
    if (one.t !== "atom") return null;
    first ??= one;
  }
  return first;
}

/** Whether a group matches any text one way at most: each branch a fixed
 *  run of atoms, no two starting with the same character. `(?:\\.|[^"])`
 *  is; `(?:a|ab)` and `(a+)` aren't. */
function oneWay(group: Node[][]): boolean {
  const starts = group.map(fixedStart);
  if (starts.some((s) => !s)) return false;
  const firsts = starts.map((s) => setOf(s!.src));
  return firsts.every((a, x) =>
    firsts.every((b, y) => x <= y || !overlap(a, b)),
  );
}

/** A repeat that can take one stretch of characters, or not: `set`. */
type Turn = { set: CharSet };

/** The repeats still able to take what comes next after `nodes`, given
 *  those able before them; refused once too many could take one run. */
function walk(nodes: Node[], turns: readonly Turn[]): Turn[] {
  let now = [...turns];
  for (const node of nodes) now = step(node, now);
  return now;
}

function add(turns: Turn[], set: CharSet): Turn[] {
  const taking = turns.filter((turn) => overlap(turn.set, set)).length + 1;
  if (taking > TURN_LIMIT)
    throw new Refused(
      "more than two repeats that can take the same characters in turn",
    );
  return [...turns, { set }];
}

const merge = (a: Turn[], b: Turn[]) => [...new Set([...a, ...b])];

/** A group once: each branch from where it starts; one that can match a
 *  text more than one way is itself a choice the characters go to. */
function groupStep(branches: Node[][], turns: Turn[]): Turn[] {
  const after = branches.map((b) => walk(b, turns)).reduce(merge);
  if (branches.length < 2 || oneWay(branches)) return after;
  return add(after, union(branches.flat().map(setIn)));
}

function step(node: Node, turns: Turn[]): Turn[] {
  if (node.t === "zero") return turns;
  // Each branch from here, against the repeats before it; it takes nothing.
  if (node.t === "ahead") {
    for (const branch of node.branches) walk(branch, turns);
    return turns;
  }
  if (node.t === "atom") {
    // A character every turn before must leave: those it can't be end.
    const set = setOf(node.src);
    return turns.filter((turn) => overlap(turn.set, set));
  }
  if (node.t === "group") return groupStep(node.branches, turns);
  const { node: inner, min, max } = node;
  if (inner.t === "group" && max === Infinity) {
    if (!oneWay(inner.branches))
      throw new Refused(
        "a group repeated without bound that can match a text more than one way",
      );
  } else if (inner.t === "group") {
    // Three times over shows what more times would.
    let now = turns;
    for (let n = 0; n < Math.min(max, 3); n++) {
      const once = groupStep(inner.branches, now);
      now = n < min ? once : merge(now, once);
    }
    return now;
  }
  const set = setIn(inner);
  if (min === max) return min ? step(inner, turns) : turns;
  const kept = min ? turns.filter((turn) => overlap(turn.set, set)) : turns;
  return add(kept, set);
}

/** How many repeats and choices a pattern holds. */
function choices(nodes: Node[][]): number {
  let n = nodes.length > 1 ? 1 : 0;
  for (const node of nodes.flat()) {
    const inner = node.t === "quant" ? node.node : node;
    if (node.t === "quant" && node.max !== node.min) n++;
    if (inner.t === "group" || inner.t === "ahead")
      n += choices(inner.branches);
  }
  return n;
}

/** Why `source` could run for ever on a long enough line, or null.
 *  Backreferences can't be bounded; lookbehind is refused as Safari
 *  before 16.4 can't compile it. `flags`: the rule's, which change what
 *  a class matches. */
export function unsafePattern(source: string, flags = ""): string | null {
  if (/\\[1-9]|\\k</.test(source)) return "a backreference";
  if (/\(\?<[=!]/.test(source)) return "a lookbehind";
  flagsNow = flags;
  try {
    const top = parse(source);
    if (choices(top) > CHOICE_LIMIT)
      return `more than ${CHOICE_LIMIT} repeats and groups of choices`;
    groupStep(top, []);
    return null;
  } catch (err) {
    if (err instanceof Refused) return err.message;
    throw err;
  }
}
