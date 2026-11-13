import { CheckIcon } from "../../engine/controls/icons";
import type { PlanEntry } from "./agent-view";

/** An external agent's plan for the exchange running: its steps, the one
 *  it is on in the text's colour, those done checked. Gone once it ends. */
export function AgentPlan({
  entries,
  label,
}: {
  entries: PlanEntry[];
  label: string;
}) {
  return (
    <section className="agent-plan" aria-label={label}>
      <ol>
        {entries.map((entry, i) => (
          <li key={i} data-status={entry.status}>
            {entry.status === "completed" ? (
              <CheckIcon className="agent-plan-mark" aria-hidden="true" />
            ) : (
              <span className="agent-plan-mark" aria-hidden="true" />
            )}
            {entry.content}
          </li>
        ))}
      </ol>
    </section>
  );
}
