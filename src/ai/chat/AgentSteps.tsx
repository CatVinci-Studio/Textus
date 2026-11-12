import type { ComponentType } from "react";
import {
  AssistantIcon,
  CodeBlockIcon,
  GenericFileIcon,
  GoToIcon,
  LightbulbIcon,
  LinkIcon,
  SearchIcon,
  TrashIcon,
  WriteModeIcon,
} from "../../engine/controls/icons";
import { getWindowAccess } from "../../plugins/app-bridge";
import { CommandText } from "../agents/AgentPermission";
import { LONG_ACTIVITY, ToolOutput } from "./AgentTurnView";
import { foldSteps, stepTitle, type AgentStep } from "./agent-steps";

/** Each kind of step by what it does, as the agent names it. */
const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  read: GenericFileIcon,
  search: SearchIcon,
  execute: CodeBlockIcon,
  edit: WriteModeIcon,
  delete: TrashIcon,
  move: GoToIcon,
  fetch: LinkIcon,
  think: LightbulbIcon,
};

/**
 * An external agent's steps in a row: one line each, its icon by what it
 * does, opening on what it said; looks in a row (reads, searches) folded
 * into one line, since what it does next is what counts.
 */
export function AgentSteps({
  steps,
  looked,
}: {
  steps: AgentStep[];
  /** "Looked at {n} things". */
  looked: (count: number) => string;
}) {
  const folder = getWindowAccess()?.rootPath() ?? null;
  return (
    <>
      {foldSteps(steps).map((part) =>
        "looks" in part ? (
          <ToolOutput
            key={part.looks[0].id}
            summary={
              <>
                <SearchIcon className="agent-tool-icon" />
                {looked(part.looks.length)}
              </>
            }
            parts={part.looks.map((step) => (
              <Step key={step.id} step={step} folder={folder} />
            ))}
          />
        ) : (
          <Step key={part.step.id} step={part.step} folder={folder} />
        ),
      )}
    </>
  );
}

function Step({ step, folder }: { step: AgentStep; folder: string | null }) {
  const Icon = ICONS[step.kind] ?? AssistantIcon;
  const title = stepTitle(step.title, folder);
  const line = (
    <>
      <Icon className="agent-tool-icon" />
      {title.length > LONG_ACTIVITY ? (
        // A long one (a chained shell command) shows two lines.
        <CommandText text={title} lines={2} className="is-quiet" />
      ) : (
        title
      )}
    </>
  );
  return step.output ? (
    <ToolOutput output={step.output} summary={line} />
  ) : (
    <div className="agent-tool-line" data-failed={step.failed || undefined}>
      {line}
    </div>
  );
}
