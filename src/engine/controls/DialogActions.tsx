import type { ReactNode } from "react";

/** A dialog's row of buttons (.close-prompt card): `start` at its start,
 *  the rest at its end, the primary last. Short of room, it wraps. */
export function DialogActions({
  start,
  className,
  children,
}: {
  start?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`close-prompt-buttons${className ? ` ${className}` : ""}`}>
      {start}
      <div className="close-prompt-spacer" />
      {children}
    </div>
  );
}
