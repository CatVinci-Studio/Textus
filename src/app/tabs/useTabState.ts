import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { flushEditor } from "../../editor/editor-flush";
import {
  makeBlankTab,
  makeStartTab,
  showsStartPage,
  type DocTab,
} from "../../document/doc-tabs";
import { lastViewMode } from "../../editor/modes/view-mode";
import { splitLayout } from "../../engine/layout/store";
import { panesOf } from "../../engine/layout/tree";

export interface TabState {
  tabs: DocTab[];
  setTabs: Dispatch<SetStateAction<DocTab[]>>;
  activeTabId: string;
  setActiveTabId: Dispatch<SetStateAction<string>>;
  /** Mirrors `tabs` synchronously. */
  tabsRef: MutableRefObject<DocTab[]>;
  /** tabsRef with every editor's still-debounced edit pulled in. */
  liveTabs: () => DocTab[];
  updateTab: (id: string, patch: Partial<DocTab>) => void;
  reorderTab: (id: string, index: number) => void;
  addBlankTab: () => void;
  /** Opens the start page in a tab of its own. */
  addStartTab: () => void;
}

/**
 * This window's open documents and which one is showing, plus the plain
 * list operations on them.
 */
export function useTabState(): TabState {
  const [tabs, setTabs] = useState<DocTab[]>(() => [makeBlankTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);

  // Lets callbacks read the latest state without re-creating on every
  // keystroke.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Anything that writes, hands off, reloads or judges dirtiness reads
  // through this. Patches the ref in place: the flush's onChange only lands
  // in `tabs` on the next render.
  const liveTabs = useCallback((): DocTab[] => {
    tabsRef.current = tabsRef.current.map((tab) => {
      const content = flushEditor(tab.id);
      return content === null || content === tab.content
        ? tab
        : { ...tab, content };
    });
    return tabsRef.current;
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
    activeTabId: inFront(tabs, activeTabId),
    setActiveTabId,
    tabsRef,
    liveTabs,
    updateTab,
    reorderTab,
    addBlankTab,
    addStartTab,
  };
}

/** The tab in use, or - when it went without another being chosen (the
 *  AI's tabs put away together) - the first island's front tab, else the
 *  last: never none, or keys and zoom have nowhere to go. */
function inFront(tabs: readonly DocTab[], id: string): string {
  if (tabs.some((tab) => tab.id === id)) return id;
  const layout = splitLayout();
  const fronts = layout ? panesOf(layout.root).map((pane) => pane.front) : [];
  const front = fronts.find((f) => f && tabs.some((tab) => tab.id === f));
  return front ?? tabs[tabs.length - 1]?.id ?? id;
}
