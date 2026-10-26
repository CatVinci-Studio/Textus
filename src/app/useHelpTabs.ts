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
  const guideOpen = tabState.tabs.some((tab) => tab.helpDoc);
  useEffect(() => {
    if (!guideOpen) return;
    let current = true;
    // Both guides in the new language, loaded first (doc-tabs.ts).
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
      // Help documents are destinations of their own, never a continuation
      // of an in-progress onboarding run. Without this, a persisted tutorial
      // could remain floating over the Markdown/AI guide after it opens.
      stopTutorial();
      // A second call before the first one's tab is in only needs to land
      // on the same tab: one menu click can reach several listeners in the
      // same instant (a re-subscribed listener whose predecessor hasn't
      // been released yet), and each used to see "no guide open" and add
      // one. Held until the guide's text has loaded and the tab is added.
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
          // Checked against the tab list as it is being updated, not the
          // last render's.
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
