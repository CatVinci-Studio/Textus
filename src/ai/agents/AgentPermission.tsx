import { useState } from "react";
import { fill } from "../../i18n/fill";
import { currentStrings } from "../../i18n/current";
import type { PendingPermission } from "./agent-exchange";

/** Commands a shell line runs one after another: `a && b | c; d`. */
export function commandCount(command: string): number {
  return command.split(/&&|\|\||[;|\n]/).filter((part) => part.trim()).length;
}

/** A command an agent shows: a few lines in code type, the rest a press
 *  away, so a long one doesn't fill the conversation. */
export function CommandText({
  text,
  lines,
  className = "",
}: {
  text: string;
  lines: number;
  className?: string;
}) {
  const t = currentStrings();
  const [open, setOpen] = useState(false);
  const long = text.split("\n").length > lines || text.length > lines * 60;
  return (
    <div className={`agent-command ${className}`}>
      <code
        className="agent-command-text"
        style={open || !long ? undefined : { WebkitLineClamp: lines }}
        data-clamped={!open && long ? "" : undefined}
      >
        {text}
      </code>
      {long && (
        <button
          type="button"
          className="text-button agent-command-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? t.chatAgentShowLess : t.chatAgentShowAll}
        </button>
      )}
    </div>
  );
}

/** A step an external agent asks to take, with the choices it offers, under
 *  the reply until one is picked or the exchange stops. A command says how
 *  many it runs, its text below in code type. */
export function AgentPermission({
  pending,
  label,
}: {
  pending: PendingPermission;
  /** "{agent} asks to go on", when the step has no title of its own. */
  label: string;
}) {
  const t = currentStrings();
  const command = pending.kind === "execute" ? pending.title : "";
  const n = command ? commandCount(command) : 0;
  const heading = command
    ? n > 1
      ? fill(t.chatAgentRunCommands, { n: String(n) })
      : t.chatAgentRunCommand
    : pending.title || label;
  return (
    <div className="agent-permission" role="group" aria-label={label}>
      <div className="agent-permission-title">{heading}</div>
      {command && <CommandText text={command} lines={3} />}
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
