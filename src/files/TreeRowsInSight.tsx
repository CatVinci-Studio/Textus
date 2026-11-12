import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { DirEntryInfo } from "../platform/bindings/files";

/** How many of a folder's rows are drawn before more are asked for. */
const ROWS_AT_ONCE = 200;

/**
 * A folder's rows, drawn as they come near: a folder of thousands of files
 * mounts its first rows and a marker that draws the next ones once it is
 * within a screen. A row that must be there (the open document's, or one
 * on the way to it) and every row above it always are.
 */
export function TreeRowsInSight({
  entries,
  needed,
  row,
}: {
  entries: DirEntryInfo[];
  needed: (entry: DirEntryInfo) => boolean;
  row: (entry: DirEntryInfo) => ReactNode;
}) {
  const [limit, setLimit] = useState(ROWS_AT_ONCE);
  const marker = useRef<HTMLDivElement>(null);
  let last = -1;
  if (entries.length > limit)
    for (let i = entries.length - 1; i >= limit; i--)
      if (needed(entries[i])) {
        last = i;
        break;
      }
  const count = Math.max(limit, last + 1);
  const more = entries.length > count;
  useEffect(() => {
    const el = marker.current;
    if (!more || !el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([seen]) => {
        if (seen?.isIntersecting) setLimit(count + ROWS_AT_ONCE);
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [more, count]);
  return (
    <>
      {entries.slice(0, count).map(row)}
      {more && (
        <div
          ref={marker}
          className="tree-rows-more"
          aria-hidden="true"
          style={{ "--rows": entries.length - count } as CSSProperties}
        />
      )}
    </>
  );
}
