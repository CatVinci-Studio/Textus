import type { AgentTurn } from "../types";

/** Tools whose calls render as cards of their own, not as steps. */
const CARD_TOOLS = new Set(["propose_edit", "add_comment"]);
export const isCardTool = (name: string) => CARD_TOOLS.has(name);

/** One tool step: the call, and its result once it is in. */
export interface ToolStep {
  name: string;
  arguments: string;
  output: string | null;
}

/**
 * The transcript's plain tool steps, folded: each run of them between a
 * message or a card becomes one group shown at its first call's place, the
 * results with their calls. A model that measured a draft a dozen times
 * used to fill the conversation with "Counting / Result" pairs.
 */
export function foldToolSteps(turns: AgentTurn[]): {
  /** Index of each run's first call -> the run's steps. */
  groups: Map<number, ToolStep[]>;
  /** Indices the groups stand in for (later calls and every result). */
  folded: Set<number>;
} {
  const groups = new Map<number, ToolStep[]>();
  const folded = new Set<number>();
  const byCall = new Map<string, ToolStep>();
  let run: ToolStep[] | null = null;
  turns.forEach((turn, i) => {
    if (turn.kind === "ToolCall" && !CARD_TOOLS.has(turn.name)) {
      const step: ToolStep = {
        name: turn.name,
        arguments: turn.arguments,
        output: null,
      };
      byCall.set(turn.call_id, step);
      if (run) {
        run.push(step);
        folded.add(i);
      } else {
        run = [step];
        groups.set(i, run);
      }
    } else if (turn.kind === "ToolResult") {
      // A card's result is the card's business; it doesn't end a run.
      const step = byCall.get(turn.call_id);
      if (step) {
        step.output = turn.output;
        folded.add(i);
      }
    } else {
      run = null;
    }
  });
  return { groups, folded };
}

/** A run's tools in order of first use, each with how often it ran and
 *  the arguments of its latest call. */
export function toolStepCounts(
  steps: ToolStep[],
): { name: string; count: number; arguments: string }[] {
  const counts: { name: string; count: number; arguments: string }[] = [];
  for (const step of steps) {
    const known = counts.find((c) => c.name === step.name);
    if (known) {
      known.count += 1;
      known.arguments = step.arguments;
    } else
      counts.push({ name: step.name, count: 1, arguments: step.arguments });
  }
  return counts;
}
