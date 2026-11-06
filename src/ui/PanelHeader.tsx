import type { ReactNode } from "react";

/**
 * A panel's top row: its title, if any, then its icon buttons at the end.
 * The one way to draw one; `className` and `actionsClassName` keep each
 * panel's own place and spacing (and the hooks themes style).
 */
export function PanelHeader({
  className,
  title,
  actionsClassName,
  dragRegion = false,
  children,
}: {
  className: string;
  title?: ReactNode;
  actionsClassName: string;
  /** The row moves the window (a chat window's only chrome). */
  dragRegion?: boolean;
  children: ReactNode;
}) {
  return (
    <header
      className={`panel-header ${className}`}
      data-tauri-drag-region={dragRegion || undefined}
    >
      {title}
      <div className={actionsClassName}>{children}</div>
    </header>
  );
}
