import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import type { DirEntryInfo } from "../platform/bindings/files";
import { DRAW_ALL_ROWS } from "../engine/controls/useTreeKeys";

/** How many of a folder's rows are drawn before more are asked for. */
const ROWS_AT_ONCE = 200;
/** Focus this close to the last drawn row draws the next ones. */
const NEAR_END = 5;

/**
 * A folder's rows, drawn as they come near: a folder of thousands of files
 * mounts its first rows and a marker that draws the next ones once it is
 * within a screen, or the keyboard nears it. A row that must be there (the
 * open document's, or one on the way to it) and every row above it always
 * are; rows once drawn stay.
 */
export function TreeRowsInSight({
  dir,
  entries,
  needed,
  row,
}: {
  /** The folder's path: a drop on the blank rows lands in it. */
  dir: string;
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
    if (count > limit) setLimit(count);
  }, [count, limit]);
  useEffect(() => {
    const el = marker.current;
    if (!more || !el) return;
    const row = el.parentElement?.querySelector<HTMLElement>(".tree-row");
    const height = row?.getBoundingClientRect().height;
    if (height) el.style.setProperty("--row", `${height}px`);
    const drawMore = () => setLimit(count + ROWS_AT_ONCE);
    const drawAll = () => flushSync(() => setLimit(entries.length));
    const onFocus = (e: FocusEvent) => {
      let near = el.previousElementSibling;
      for (let i = 0; near && i < NEAR_END; i++) {
        if (near.contains(e.target as Node)) return drawMore();
        near = near.previousElementSibling;
      }
    };
    const parent = el.parentElement;
    parent?.addEventListener("focusin", onFocus);
    el.addEventListener(DRAW_ALL_ROWS, drawAll);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            ([seen]) => {
              if (seen?.isIntersecting) drawMore();
            },
            { root: el.closest(".sidebar-body"), rootMargin: "100% 0px" },
          );
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      parent?.removeEventListener("focusin", onFocus);
      el.removeEventListener(DRAW_ALL_ROWS, drawAll);
    };
  }, [more, count, entries.length]);
  return (
    <>
      {entries.slice(0, count).map(row)}
      {more && (
        <div
          ref={marker}
          className="tree-rows-more"
          aria-hidden="true"
          data-drop-dir={dir}
          data-more-rows=""
          style={{ "--rows": entries.length - count } as CSSProperties}
        />
      )}
    </>
  );
}
