import { useCallback, useEffect, useRef } from "react";
import {
  helpDocContent,
  makeBlankTab,
  type HelpDoc,
} from "../document/doc-tabs";
import type { Lang } from "../i18n/langs";
import type { TabState } from "./tabs/useTabState";

const HELP_DOCS: readonly HelpDoc[] = ["markdown", "agent"];

/**
 * Help guides open as clean pathless drafts in the UI language: free to
 * play with, closed without saving.
 */
export function useHelpTabs(opts: {
  tabState: TabState;
  language: Lang;
  stopTutorial: () => void;
}) {
  const { tabState, language, stopTutorial } = opts;
  const { setTabs, setActiveTabId } = tabState;

  // Switching the UI language swaps the text of every unedited open guide.
  const guideOpen = tabState.tabs.some((tab) => tab.helpDoc);
  useEffect(() => {
    if (!guideOpen) return;
    let current = true;
    void Promise.all(
      HELP_DOCS.map((doc) => helpDocContent(doc, language)),
    ).then((texts) => {
      if (!current) return;
      const guide = new Map(HELP_DOCS.map((doc, i) => [doc, texts[i]]));
      setTabs((prev) => {
        let changed = false;
        const next = prev.map((tab) => {
          if (!tab.helpDoc || tab.content !== tab.savedContent) return tab;
          const content = guide.get(tab.helpDoc)!;
          if (content === tab.content) return tab;
          changed = true;
          return {
            ...tab,
            content,
            savedContent: content,
            reloadKey: tab.reloadKey + 1,
          };
        });
        return changed ? next : prev;
      });
    });
    return () => {
      current = false;
    };
  }, [language, guideOpen, setTabs]);
  const openingHelp = useRef(new Set<HelpDoc>());
  const openHelpTab = useCallback(
    (doc: HelpDoc) => {
      // A guide is never part of an onboarding run: a persisted tutorial
      // would otherwise float over it.
      stopTutorial();
      // One menu click can reach several listeners at once; held until the
      // tab is added so only one adds a guide.
      if (openingHelp.current.has(doc)) return;
      openingHelp.current.add(doc);
      void helpDocContent(doc, language)
        .then((content) => {
          const fresh = {
            ...makeBlankTab(),
            content,
            savedContent: content,
            helpDoc: doc,
          };
          // Checked against the tab list being updated, not the last render's.
          let target = fresh.id;
          setTabs((prev) => {
            const existing = prev.find((tab) => tab.helpDoc === doc);
            if (existing) {
              target = existing.id;
              return prev;
            }
            return [...prev, fresh];
          });
          setActiveTabId(() => target);
        })
        .finally(() =>
          requestAnimationFrame(() => openingHelp.current.delete(doc)),
        );
    },
    [language, stopTutorial, setTabs, setActiveTabId],
  );

  return { openHelpTab };
}
