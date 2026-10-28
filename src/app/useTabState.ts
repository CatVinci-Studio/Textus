import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { flushEditor } from "../editor/editor-flush";
import { makeBlankTab, type DocTab } from "../document/doc-tabs";
import { lastViewMode } from "../editor/modes/view-mode";

export interface TabState {
  tabs: DocTab[];
  setTabs: Dispatch<SetStateAction<DocTab[]>>;
  activeTabId: string;
  setActiveTabId: Dispatch<SetStateAction<string>>;
  /** Mirrors `tabs` synchronously - see useTabState. */
  tabsRef: MutableRefObject<DocTab[]>;
  /** tabsRef with every editor's still-debounced edit pulled in. */
  liveTabs: () => DocTab[];
  updateTab: (id: string, patch: Partial<DocTab>) => void;
  reorderTab: (id: string, index: number) => void;
  addBlankTab: () => void;
}

/**
 * This window's open documents and which one is showing, plus the plain
 * list operations on them. Pulled out of App.tsx; opening, saving and
 * closing build on it in their own hooks.
 */
export function useTabState(): TabState {
  const [tabs, setTabs] = useState<DocTab[]>(() => [makeBlankTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);

  // Mirrors `tabs` synchronously so callbacks (open/save/close) can read the
  // latest state without depending on - and thus re-creating - on every
  // keystroke.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // tabsRef with every editor's still-debounced edit pulled in (see
  // editor-flush.ts). Anything that writes, hands off, reloads or judges
  // dirtiness reads through this, never tabsRef directly. Patches the ref
  // in place because the onChange the flush triggers only lands in `tabs`
  // on the next render.
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

  // Within-bar drag-to-reorder (TabBar.tsx): put tab `id` at `index`
  // among the remaining tabs.
  const reorderTab = useCallback((id: string, index: number) => {
    setTabs((prev) => {
      const moved = prev.find((tab) => tab.id === id);
      if (!moved) return prev;
      const rest = prev.filter((tab) => tab.id !== id);
      rest.splice(index, 0, moved);
      return rest;
    });
  }, []);

  const addBlankTab = useCallback(() => {
    const blank = { ...makeBlankTab(), ...lastViewMode() };
    setTabs((prev) => [...prev, blank]);
    setActiveTabId(blank.id);
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
  };
}
