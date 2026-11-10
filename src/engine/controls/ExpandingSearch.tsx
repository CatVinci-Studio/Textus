import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./IconButton";
import { SearchIcon } from "./icons";

/**
 * Search as a pane's or a section's: a magnifier among its other buttons
 * that opens into the field in place, and folds back when left empty (Esc,
 * or focus going elsewhere). Open while it holds a query (`active`).
 * `field` draws the field - a plain SearchField, or one that drives a
 * list of results.
 */
export function ExpandingSearch({
  label,
  active,
  field,
}: {
  /** What is searched: "搜索设置". */
  label: string;
  active: boolean;
  field: () => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const shown = open || active;
  useEffect(() => {
    if (open) box.current?.querySelector("input")?.focus();
  }, [open]);
  if (!shown)
    return (
      <IconButton
        label={label}
        className="tree-tool tx-search-open"
        onClick={() => setOpen(true)}
      >
        <SearchIcon />
      </IconButton>
    );
  return (
    <div
      ref={box}
      className="tx-search-expanded"
      onBlur={(e) => {
        if (!active && !e.currentTarget.contains(e.relatedTarget as Node))
          setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !active) setOpen(false);
      }}
    >
      {field()}
    </div>
  );
}

/**
 * A pane's top line (pane.css): its name - unless what picked the pane
 * already says it - then its search, folded, and its buttons. Open, the
 * search takes the name's place.
 */
export function PaneTop({
  title,
  search,
  children,
}: {
  title?: ReactNode;
  search?: { label: string; active: boolean; field: () => ReactNode };
  children?: ReactNode;
}) {
  return (
    <div className="tx-pane-top" data-has-search={search ? "" : undefined}>
      {title !== undefined ? (
        <h2 className="tx-pane-title">{title}</h2>
      ) : (
        <span className="tx-pane-fill" />
      )}
      {search && <ExpandingSearch {...search} />}
      {children}
    </div>
  );
}
