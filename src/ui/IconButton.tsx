import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip";

/**
 * A button that is only an icon: named for assistive technology and hinted
 * by the app's Tooltip (never `title`), the one way to make one. `className`
 * picks its size and place (`tx-icon-button`, a panel header's).
 */
export function IconButton({
  label,
  hint = label,
  onClick,
  pressed,
  disabled,
  className = "tx-icon-button",
  children,
}: {
  label: string;
  /** What the tooltip says, when more than the name (a toggle's state). */
  hint?: string;
  onClick: () => void;
  /** For a toggle: whether it is on. */
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip text={hint}>
      <button
        type="button"
        className={className}
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}
