import { useCallback, useEffect, useRef } from "react";
import {
  helpDocContent,
  makeBlankTab,
  type HelpDoc,
} from "../document/doc-tabs";
import type { Lang } from "../i18n/langs";
import type { TabState } from "./useTabState";

/**
 * Help menu docs (Markdown Guide / AI Agent Guide): bundled documents (per
 * UI language), opened as clean pathless drafts - play with them freely,
 * close without saving. savedContent === content so they start non-dirty.
 */
export function useHelpTabs(opts: {
  tabState: TabState;
  language: Lang;
  stopTutorial: () => void;
}) {
  const { tabState, language, stopTutorial } = opts;
  const { setTabs, setActiveTabId } = tabState;

  // A guide follows the UI language: switching it swaps the text of every
  // open guide the user hasn't edited (an edited one is theirs to keep).
  useEffect(() => {
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((tab) => {
        if (!tab.helpDoc || tab.path || tab.content !== tab.savedContent)
          return tab;
        const content = helpDocContent(tab.helpDoc, language);
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
  }, [language, setTabs]);
  const openingHelp = useRef(new Set<HelpDoc>());
  const openHelpTab = useCallback(
    (doc: HelpDoc) => {
      // Help documents are destinations of their own, never a continuation
      // of an in-progress onboarding run. Without this, a persisted tutorial
      // could remain floating over the Markdown/AI guide after it opens.
      stopTutorial();
      // Checked against the tab list as it is being updated, not the last
      // render's: one menu click can reach several listeners in the same
      // instant (a re-subscribed listener whose predecessor hasn't been
      // released yet), and each used to see "no guide open" and add one.
      const content = helpDocContent(doc, language);
      const fresh = {
        ...makeBlankTab(),
        content,
        savedContent: content,
        helpDoc: doc,
      };
      // A second call before React has applied the first one only needs to
      // land on the same tab.
      if (openingHelp.current.has(doc)) return;
      openingHelp.current.add(doc);
      requestAnimationFrame(() => openingHelp.current.delete(doc));
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
    },
    [language, stopTutorial, setTabs, setActiveTabId],
  );

  return { openHelpTab };
}
