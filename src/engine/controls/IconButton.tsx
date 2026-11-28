import type { MouseEvent, ReactNode } from "react";
import { Tooltip } from "./Tooltip";
import type { BubbleSide } from "./Bubble";
import type { useMenuButton } from "./useMenuButton";

/**
 * A button that is only an icon: named for assistive technology and hinted
 * by the app's Tooltip (never `title`), the one way to make one. `className`
 * picks its size and place (`tx-icon-button`, a panel header's). With
 * `opens`, a useMenuButton's button: it opens that menu.
 */
export function IconButton({
  label,
  hint = label,
  hintSide,
  keys,
  onClick,
  opens,
  pressed,
  disabled,
  className = "tx-icon-button",
  children,
}: {
  label: string;
  /** What the tooltip says, when more than the name (a toggle's state). */
  hint?: string;
  /** Where the tooltip prefers to sit (below by default). */
  hintSide?: BubbleSide;
  /** Its shortcut as stored ("mod+b"), shown in the tooltip. */
  keys?: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  opens?: ReturnType<typeof useMenuButton>["button"];
  /** For a toggle: whether it is on. */
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip text={hint} side={hintSide} keys={keys}>
      <button
        type="button"
        className={className}
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        {...opens}
      >
        {children}
      </button>
    </Tooltip>
  );
}
