import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip";

/**
 * A button that is only an icon: named for assistive technology and hinted
 * by the app's Tooltip (never `title`), the one way to make one. `className`
 * picks its size and place (`tx-icon-button`, a panel header's).
 */
export function IconButton({
  label,
  onClick,
  pressed,
  className = "tx-icon-button",
  children,
}: {
  label: string;
  onClick: () => void;
  /** For a toggle: whether it is on. */
  pressed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip text={label}>
      <button
        type="button"
        className={className}
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}
