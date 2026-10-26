import { useEffect, useRef } from "react";
import type { DocTab } from "../../document/doc-tabs";
import { getUiState, setUiState, type UiState } from "../../storage/ui-state";
import {
  clampRatio,
  setSplitLayout,
  splitLayout,
  subscribeSplit,
} from "./split-layout";

type Saved = NonNullable<UiState["splitLayout"]>;

/** How long after the window opens its last split may still come back:
 *  the documents of the last session open one after another. */
const RESTORE_MS = 8000;

/** The split saved, if it is one this window can show. */
export function readSavedSplit(raw: unknown): Saved | null {
  if (!raw || typeof raw !== "object") return null;
  const { direction, ratio, paths } = raw as Partial<Saved>;
  if (direction !== "row" && direction !== "column") return null;
  if (!Array.isArray(paths) || paths.length !== 2) return null;
  if (!paths.every((p) => typeof p === "string" && p)) return null;
  if (paths[0] === paths[1]) return null;
  return {
    direction,
    ratio: clampRatio(typeof ratio === "number" ? ratio : 0.5),
    paths: [paths[0], paths[1]],
  };
}

/**
 * The split comes back with the window: the two documents it showed, by
 * path, side by side or one above the other, sharing the space as they
 * did - once both are open again. Until then (or a few seconds, or the
 * user splitting first) nothing is saved, so the restore can't be undone
 * by the window starting with one document.
 */
export function useSplitRestore(
  tabs: readonly DocTab[],
  activate: (id: string) => void,
): void {
  const saved = useRef<Saved | null | undefined>(undefined);
  const settled = useRef(false);
  saved.current ??= readSavedSplit(getUiState("splitLayout"));

  useEffect(() => {
    const settle = () => (settled.current = true);
    const timer = setTimeout(settle, RESTORE_MS);
    const stop = subscribeSplit(() => {
      const layout = splitLayout();
      if (layout) settle();
      if (!settled.current) return;
      const paths = layout?.panes.map(
        (id) => tabsRef.current.find((tab) => tab.id === id)?.path ?? null,
      );
      setUiState(
        "splitLayout",
        layout && paths?.[0] && paths[1]
          ? {
              direction: layout.direction,
              ratio: layout.ratio,
              paths: [paths[0], paths[1]],
            }
          : null,
      );
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, []);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  useEffect(() => {
    const want = saved.current;
    if (settled.current || !want) return;
    const ids = want.paths.map(
      (path) => tabs.find((tab) => tab.path === path)?.id,
    );
    if (!ids[0] || !ids[1]) return;
    settled.current = true;
    // Its first document in front, so the split keeps both.
    activate(ids[0]);
    setSplitLayout({
      direction: want.direction,
      ratio: want.ratio,
      panes: [ids[0], ids[1]],
    });
  }, [tabs, activate]);
}
