import type { AgentTurn } from "../types";

/**
 * An external agent's steps (`agent_tool` calls and their results) read
 * for the panel: each with its kind and output, and steps in a row as one
 * run, shown under its first call.
 */

export interface AgentStep {
  id: string;
  title: string;
  /** The agent's own kind: read, search, execute, edit, fetch, think... */
  kind: string;
  /** What it said, if more than how it ended; null while it runs. */
  output: string | null;
  done: boolean;
  failed: boolean;
}

const AGENT_TOOL = "agent_tool";
/** What agent-view.ts writes for a step that said nothing. */
const BARE = new Set(["Done.", "Failed."]);

function stepOf(call: AgentTurn & { kind: "ToolCall" }): AgentStep {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments) ?? {};
  } catch {
    // An unreadable line: the step without its title.
  }
  return {
    id: call.call_id,
    title: typeof args.title === "string" ? args.title : "",
    kind: typeof args.kind === "string" ? args.kind : "other",
    output: null,
    done: false,
    failed: args.status === "failed",
  };
}

/** Each run's steps under its first call's id; the run's other calls map
 *  to an empty list. */
export function agentStepRuns(turns: AgentTurn[]): Map<string, AgentStep[]> {
  const runs = new Map<string, AgentStep[]>();
  let run: AgentStep[] | null = null;
  const byId = new Map<string, AgentStep>();
  for (const turn of turns) {
    if (turn.kind === "ToolCall" && turn.name === AGENT_TOOL) {
      const step = stepOf(turn);
      byId.set(step.id, step);
      if (run) {
        run.push(step);
        runs.set(step.id, []);
      } else {
        run = [step];
        runs.set(step.id, run);
      }
      continue;
    }
    const step = turn.kind === "ToolResult" ? byId.get(turn.call_id) : null;
    if (step && turn.kind === "ToolResult") {
      step.done = true;
      step.failed ||= turn.output === "Failed.";
      step.output = BARE.has(turn.output) ? null : turn.output;
      continue;
    }
    run = null;
  }
  return runs;
}

/** Kinds that only look (read, search, fetch, think): several in a row
 *  fold into one line, since what the agent does next is what counts. */
const LOOKS = new Set(["read", "search", "fetch", "think"]);
const FOLD_FROM = 3;

/** A run as it shows: single steps, and looks in a row folded. */
export function foldSteps(
  steps: AgentStep[],
): ({ step: AgentStep } | { looks: AgentStep[] })[] {
  const out: ({ step: AgentStep } | { looks: AgentStep[] })[] = [];
  let looks: AgentStep[] = [];
  const flush = () => {
    if (looks.length >= FOLD_FROM) out.push({ looks });
    else out.push(...looks.map((step) => ({ step })));
    looks = [];
  };
  for (const step of steps) {
    if (LOOKS.has(step.kind)) looks.push(step);
    else {
      flush();
      out.push({ step });
    }
  }
  flush();
  return out;
}

/** A step's title as the panel shows it: paths inside `folder` from it,
 *  and without the backticks some agents put round a command. */
export function stepTitle(title: string, folder: string | null): string {
  let shown = title.trim().replace(/^`([^`]*)`$/, "$1");
  const root = folder?.replace(/[\\/]+$/, "");
  // A drive's root ("/") leaves nothing to take off.
  if (root) {
    shown = shown
      .split(root + "/")
      .join("")
      .split(root + "\\")
      .join("");
    // The folder itself, by its name.
    if (shown.endsWith(" " + root))
      shown = shown.slice(0, -root.length) + (root.split(/[\\/]/).pop() ?? "");
  }
  return shown;
}
