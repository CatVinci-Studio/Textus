import type { PendingPermission } from "./agent-exchange";

/** A step an external agent asks to take, with the choices it offers, under
 *  the reply until one is picked or the exchange stops. */
export function AgentPermission({
  pending,
  label,
}: {
  pending: PendingPermission;
  /** "{agent} asks to go on", when the step has no title of its own. */
  label: string;
}) {
  return (
    <div className="agent-permission" role="group" aria-label={label}>
      <div className="agent-permission-title">{pending.title || label}</div>
      <div className="agent-permission-actions">
        {pending.options.map((option) => (
          <button
            key={option.optionId}
            className="inline-chat-action"
            onClick={() => pending.choose(option.optionId)}
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  );
}
