/**
 * Learning from revision choices: every ✓ / ✕ (or Accept / Reject) of a
 * change whose kind change-kind.ts can name is kept in a small log, and
 * when the writer has turned the same kind down again and again, one quiet
 * suggestion offers to remember it as a requirement (RevisionLearning.tsx).
 *
 * The log holds kinds, not text - a swapped word or mark at most - lives
 * beside the personal memories (`revision_choices_*` in ai/memory.rs) and
 * is never sent anywhere. Only "Remember" writes a memory, which the
 * Memory tab lists and the AI then follows.
 */

import { classifyChange, kindKey, type ChangeKind } from "./change-kind";

/** One decided change of one kind. `taken`: accepted. */
export interface Choice {
  kind: string;
  taken: boolean;
  /** The proposal (its call id), so evidence from one proposal alone
   *  doesn't count as a habit. */
  proposal: string;
  at: number;
}

export type Answer = "remembered" | "later" | "never";

/** The log as stored (`revision_choices_read/write` in ai/memory.rs, which
 *  keeps it as given). */
export interface ChoiceLog {
  choices: Choice[];
  /** What the writer said to a suggestion, by kind. */
  answers: Record<string, { answer: Answer; at: number }>;
  /** When the last suggestion was shown: the cooldown runs from it. */
  lastAsked: number | null;
}

/** The newest decisions kept; older ones drop off. */
export const MAX_CHOICES = 200;
const MAX_ANSWERS = 100;
/** Rejections of one kind in a row, across at least this many proposals. */
export const REJECTIONS = 3;
export const PROPOSALS = 2;
/** At most one suggestion a day. */
export const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const emptyLog = (): ChoiceLog => ({
  choices: [],
  answers: {},
  lastAsked: null,
});

/** A stored log, or an empty one for anything else (none yet, a file from
 *  a later version that can't be read). */
export function parseLog(value: unknown): ChoiceLog {
  const v = value as Partial<ChoiceLog> | null;
  if (!v || typeof v !== "object" || !Array.isArray(v.choices))
    return emptyLog();
  return {
    choices: v.choices.filter(
      (c) =>
        typeof c?.kind === "string" &&
        typeof c.taken === "boolean" &&
        typeof c.proposal === "string",
    ),
    answers: v.answers && typeof v.answers === "object" ? v.answers : {},
    lastAsked: typeof v.lastAsked === "number" ? v.lastAsked : null,
  };
}

/** The choices one decided change makes: one per kind it is. */
export function choicesFor(
  proposal: string,
  changes: { before: string; after: string; taken: boolean }[],
  at: number,
): Choice[] {
  return changes.flatMap(({ before, after, taken }) =>
    classifyChange(before, after).map((kind) => ({
      kind: kindKey(kind),
      taken,
      proposal,
      at,
    })),
  );
}

export function record(log: ChoiceLog, choices: Choice[]): ChoiceLog {
  return {
    ...log,
    choices: [...log.choices, ...choices].slice(-MAX_CHOICES),
  };
}

export function answer(
  log: ChoiceLog,
  kind: string,
  given: Answer,
  at: number,
): ChoiceLog {
  const answers = Object.entries({
    ...log.answers,
    [kind]: { answer: given, at },
  })
    .sort(([, x], [, y]) => x.at - y.at)
    .slice(-MAX_ANSWERS);
  return { ...log, answers: Object.fromEntries(answers) };
}

/** The kind to suggest remembering now, or null: one rejected at least
 *  REJECTIONS times in a row (no acceptance of it in between) across at
 *  least PROPOSALS proposals, never answered "remembered" or "never" - and
 *  after "Not now", only on new evidence - with no suggestion shown in the
 *  last COOLDOWN_MS. Of several, the longest run. */
export function suggestion(log: ChoiceLog, now: number): string | null {
  if (log.lastAsked !== null && now - log.lastAsked < COOLDOWN_MS) return null;
  const runs = new Map<string, { count: number; proposals: Set<string> }>();
  const ended = new Set<string>();
  for (let i = log.choices.length - 1; i >= 0; i--) {
    const c = log.choices[i];
    if (ended.has(c.kind)) continue;
    const said = log.answers[c.kind];
    if (c.taken || (said?.answer === "later" && c.at <= said.at)) {
      ended.add(c.kind);
      continue;
    }
    const run = runs.get(c.kind) ?? { count: 0, proposals: new Set() };
    run.count++;
    run.proposals.add(c.proposal);
    runs.set(c.kind, run);
  }
  let best: string | null = null;
  let longest = 0;
  for (const [kind, run] of runs) {
    const said = log.answers[kind]?.answer;
    if (said === "remembered" || said === "never") continue;
    if (run.count < REJECTIONS || run.proposals.size < PROPOSALS) continue;
    if (run.count > longest) [best, longest] = [kind, run.count];
  }
  return best;
}

/** The words a suggestion and the memory it saves are made of
 *  (i18n/locales: learn*). */
export interface LearnLabels {
  learnQuoted: string;
  learnSwap: string;
  learnSwapRule: string;
  learnWidthHalf: string;
  learnWidthHalfRule: string;
  learnWidthFull: string;
  learnWidthFullRule: string;
  learnOxfordAdd: string;
  learnOxfordAddRule: string;
  learnOxfordRemove: string;
  learnOxfordRemoveRule: string;
  learnContractionsExpand: string;
  learnContractionsExpandRule: string;
  learnContractionsAdd: string;
  learnContractionsAddRule: string;
  learnSplit: string;
  learnSplitRule: string;
  learnMerge: string;
  learnMergeRule: string;
  learnShorter: string;
  learnShorterRule: string;
  learnLonger: string;
  learnLongerRule: string;
}

/** What was turned down, for "You turned down {what} several times", and
 *  the requirement remembering it saves, in the interface language. */
export function describeKind(
  kind: ChangeKind,
  t: LearnLabels,
): { what: string; rule: string } {
  const pick = (what: string, rule: string) => ({ what, rule });
  switch (kind.type) {
    case "swap": {
      // A quote style reads as itself (「」); a word or mark is quoted.
      const show = (s: string) =>
        [...s].length === 2 && !/[\p{L}\p{N}]/u.test(s)
          ? s
          : t.learnQuoted.replace("{text}", s);
      const fill = (s: string) =>
        s.replace("{from}", show(kind.from)).replace("{to}", show(kind.to));
      return pick(fill(t.learnSwap), fill(t.learnSwapRule));
    }
    case "width":
      return kind.to === "half"
        ? pick(t.learnWidthHalf, t.learnWidthHalfRule)
        : pick(t.learnWidthFull, t.learnWidthFullRule);
    case "oxford":
      return kind.add
        ? pick(t.learnOxfordAdd, t.learnOxfordAddRule)
        : pick(t.learnOxfordRemove, t.learnOxfordRemoveRule);
    case "contractions":
      return kind.expand
        ? pick(t.learnContractionsExpand, t.learnContractionsExpandRule)
        : pick(t.learnContractionsAdd, t.learnContractionsAddRule);
    case "sentences":
      return kind.split
        ? pick(t.learnSplit, t.learnSplitRule)
        : pick(t.learnMerge, t.learnMergeRule);
    case "length":
      return kind.shorter
        ? pick(t.learnShorter, t.learnShorterRule)
        : pick(t.learnLonger, t.learnLongerRule);
  }
}
