import {
  useCallback,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import { flushEditor } from "../../editor/tab-editor";
import {
  makeBlankTab,
  makeStartTab,
  showsStartPage,
  type DocTab,
} from "../../document/doc-tabs";
import { lastViewMode } from "../../editor/modes/view-mode";
import {
  activateTab,
  setWindowTabs,
  startWindowTabs,
  subscribeSplit,
  tabInUse,
  windowTabs,
} from "../../engine/layout/store";

export interface TabState {
  tabs: DocTab[];
  setTabs: Dispatch<SetStateAction<DocTab[]>>;
  activeTabId: string;
  setActiveTabId: Dispatch<SetStateAction<string>>;
  /** The window's tabs now, read from its model: for callbacks that must
   *  not wait for a render. */
  tabsRef: { readonly current: DocTab[] };
  /** The tabs with every editor's still-debounced edit pulled into the
   *  model first. */
  liveTabs: () => DocTab[];
  updateTab: (id: string, patch: Partial<DocTab>) => void;
  reorderTab: (id: string, index: number) => void;
  addBlankTab: () => void;
  /** Opens the start page in a tab of its own. */
  addStartTab: () => void;
}

// The window starts with one blank document; a split asked for with no
// other tab to take gets a blank one in the view last chosen.
startWindowTabs<DocTab>([makeBlankTab()], () => ({
  ...makeBlankTab(),
  ...lastViewMode(),
}));

const allTabs = () => windowTabs<DocTab>() as DocTab[];

const setTabs: Dispatch<SetStateAction<DocTab[]>> = (next) =>
  setWindowTabs<DocTab>((prev) =>
    typeof next === "function" ? next(prev as DocTab[]) : next,
  );

const setActiveTabId: Dispatch<SetStateAction<string>> = (next) =>
  activateTab(typeof next === "function" ? next(tabInUse()) : next);

/**
 * This window's open documents and which one is showing, plus the plain
 * list operations on them: views of the window's model (engine/layout/
 * store.ts), which keeps them and its islands as one.
 */
/** The model's tabs, as a ref's `current`. */
const tabsRef = {
  get current() {
    return allTabs();
  },
};

export function useTabState(): TabState {
  const tabs = useSyncExternalStore(subscribeSplit, allTabs);
  const activeTabId = useSyncExternalStore(subscribeSplit, tabInUse);

  // Anything that writes, hands off, reloads or judges dirtiness reads
  // through this: each editor's text not yet reported goes into the model.
  const liveTabs = useCallback((): DocTab[] => {
    const flushed = new Map<string, string>();
    for (const tab of allTabs()) {
      const content = flushEditor(tab.id);
      if (content !== null && content !== tab.content)
        flushed.set(tab.id, content);
    }
    if (flushed.size)
      setTabs((prev) =>
        prev.map((tab) =>
          flushed.has(tab.id) ? { ...tab, content: flushed.get(tab.id)! } : tab,
        ),
      );
    return allTabs();
  }, []);

  const updateTab = useCallback((id: string, patch: Partial<DocTab>) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)),
    );
  }, []);

  // Put tab `id` at `index` among the remaining tabs.
  const reorderTab = useCallback((id: string, index: number) => {
    setTabs((prev) => {
      const moved = prev.find((tab) => tab.id === id);
      if (!moved) return prev;
      const rest = prev.filter((tab) => tab.id !== id);
      rest.splice(index, 0, moved);
      return rest;
    });
  }, []);

  // A start page open turns into the new document instead of staying beside it.
  const addBlankTab = useCallback(() => {
    const start = tabsRef.current.find(showsStartPage);
    if (start) {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === start.id
            ? { ...tab, start: false, ...lastViewMode() }
            : tab,
        ),
      );
      setActiveTabId(start.id);
      return;
    }
    const blank = { ...makeBlankTab(), ...lastViewMode() };
    setTabs((prev) => [...prev, blank]);
    setActiveTabId(blank.id);
  }, []);

  const addStartTab = useCallback(() => {
    const start = makeStartTab();
    setTabs((prev) => [...prev.filter((tab) => !showsStartPage(tab)), start]);
    setActiveTabId(start.id);
  }, []);

  return {
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    tabsRef,
    liveTabs,
    updateTab,
    reorderTab,
    addBlankTab,
    addStartTab,
  };
}
