import type { ReactNode } from "react";

/**
 * A card's or a group's head: a mark, what it is, and its tools at the
 * end. Short of room the tools move to a line below, as one, starting
 * under the title; the mark stays beside the first line (.tx-head-row).
 */
export function HeadRow({
  className,
  mark,
  title,
  tools,
}: {
  className?: string;
  mark?: ReactNode;
  title: ReactNode;
  tools?: ReactNode;
}) {
  return (
    <div className={`tx-head-row${className ? ` ${className}` : ""}`}>
      {mark}
      <div className="tx-head-main">
        {title}
        {tools && <span className="tx-head-tools">{tools}</span>}
      </div>
    </div>
  );
}
