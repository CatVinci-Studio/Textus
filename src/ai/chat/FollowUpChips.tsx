import type { KeyboardEvent, MouseEvent } from "react";

/**
 * The suggested next messages as buttons over the message box: a click
 * sends one. One tab stop; the arrow keys walk the rest.
 */
export function FollowUpChips({
  suggestions,
  label,
  holdFocus,
  onPick,
}: {
  suggestions: string[];
  /** The group's accessible name. */
  label: string;
  /** On a phone a tap leaves the keyboard up, as the composer's buttons do. */
  holdFocus: boolean;
  onPick: (text: string) => void;
}) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    const chips = [...e.currentTarget.querySelectorAll("button")];
    const at = chips.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    chips[(at + step + chips.length) % chips.length].focus();
  }

  return (
    <div
      className="inline-chat-follow-ups"
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {suggestions.map((text, i) => (
        <button
          key={text}
          type="button"
          className="inline-chat-action inline-chat-follow-up"
          tabIndex={i === 0 ? 0 : -1}
          title={text}
          onMouseDown={
            holdFocus ? (e: MouseEvent) => e.preventDefault() : undefined
          }
          onClick={() => onPick(text)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
