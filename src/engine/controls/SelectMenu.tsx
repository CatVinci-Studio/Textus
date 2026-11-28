import {
  useLayoutEffect,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { endExits } from "../motion/usePresence";

/** Every menu and select list the app draws: one shows at a time, so one
 *  opening ends the exit of any still on its way out (usePresence.ts). */
export function endListExits() {
  endExits("[data-floating-menu], [data-floating-select]");
}

/**
 * The open list of a drawn select (Select, the AI mode picker, a code
 * block's language): one floating listbox on <body>, its rows the
 * `ui-select-option`s inside. `className` adds a list's own place and size.
 */
export function SelectMenu({
  listRef,
  id,
  state,
  className,
  label,
  activeId,
  place,
  onKeyDown,
  children,
}: {
  listRef: Ref<HTMLUListElement>;
  id: string;
  /** usePresence's state: "closing" takes it out of the tab order. */
  state: string;
  className?: string;
  label?: string;
  /** The row the keys are on, by its id; undefined when the input holds it. */
  activeId?: string;
  place: CSSProperties;
  onKeyDown?: (e: KeyboardEvent<HTMLUListElement>) => void;
  children: ReactNode;
}) {
  useLayoutEffect(endListExits, []);
  return createPortal(
    <ul
      ref={listRef}
      id={id}
      data-state={state}
      inert={state === "closing" || undefined}
      className={`ui-select-menu floating-surface${className ? ` ${className}` : ""}`}
      role="listbox"
      aria-label={label}
      aria-activedescendant={activeId}
      tabIndex={-1}
      style={place}
      data-floating-select=""
      onKeyDown={onKeyDown}
    >
      {children}
    </ul>,
    document.body,
  );
}
