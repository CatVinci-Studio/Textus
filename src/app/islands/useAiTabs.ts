import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  closeConversation,
  liveConversation,
  onLiveConversation,
  onOpenConversations,
  openConversations,
  setLiveConversation,
} from "../../ai/chat/conversation-scope";
import { useChatHistory } from "../../ai/chat/chat-history";
import { makeBlankTab, type DocTab } from "../../document/doc-tabs";
import { openBeside, moveToPane, splitLayout } from "../../engine/layout/store";
import { panesOf, paneWithTab } from "../../engine/layout/tree";
import type { TabState } from "../tabs/useTabState";
import { pageOf } from "../tabs/page-tabs";
import { scaledPx } from "../../engine/tokens/chrome-scale";
import {
  AI_PRESS_EVENT,
  DRAFT,
  aiMount,
  aiMountsVersion,
  onAiMounts,
} from "./ai-tabs";

const NONE: string[] = [];

/** The conversation an AI tab shows. */
const conversationOf = (tab: DocTab) =>
  (tab.view?.state as { conversation?: string } | undefined)?.conversation ??
  DRAFT;

const isAiTab = (tab: DocTab) => pageOf(tab) === "ai";

/** The AI island's first width: a panel's (380 at the interface's size),
 *  never under a third or over half of the islands' area. */
function aiShare(): number {
  const area = document.querySelector(".main-pane")?.clientWidth ?? 0;
  if (!area) return 0.35;
  return Math.min(0.5, Math.max(0.3, scaledPx(380) / area));
}

/**
 * The AI's conversations as tabs (desktop): while the AI is shown, one tab
 * per conversation open in the folder (a draft's while none is), first in
 * an island of their own on the right, then wherever they are dragged.
 * Closing one closes its conversation; closing the last hides the AI. The
 * tab brought to the front makes its conversation the live one; the live
 * one's tab is where the document in front draws it (the returned element).
 * The AI button, pressed while shown, brings that tab to the front - or,
 * already there in an island of AI tabs only, hides the AI.
 */
export function useAiTabs({
  tabs,
  scope,
  shown,
  setShown,
}: {
  tabs: TabState;
  scope: string | null;
  shown: boolean;
  setShown: (shown: boolean) => void;
}): HTMLElement | null {
  const open = useSyncExternalStore(onOpenConversations, () =>
    scope ? openConversations(scope) : NONE,
  );
  const live = useSyncExternalStore(
    (changed) => onLiveConversation(() => changed()),
    () => (scope ? liveConversation(scope) : null),
  );
  const history = useChatHistory();
  useSyncExternalStore(onAiMounts, aiMountsVersion);
  const had = useRef<ReadonlySet<string>>(new Set());
  // The window's first tabs: shown as it opens, the document stays in use.
  const opening = useRef(true);

  const wanted = !shown ? NONE : open.length ? open : [live ?? DRAFT];
  const titles = new Map(history.map((entry) => [entry.id, entry.title]));
  const { tabsRef, setTabs, updateTab, activeTabId } = tabs;

  // The tabs follow the conversations: one each, a closed one's gone, a
  // draft's tab becoming its conversation once sent.
  useEffect(() => {
    const current = tabsRef.current.filter(isAiTab);
    const have = new Set(current.map(conversationOf));
    // A tab the user closed: its conversation closes (it stays in History).
    for (const id of had.current)
      if (!have.has(id) && wanted.includes(id) && scope && id !== DRAFT) {
        const next = closeConversation(scope, id);
        if (next) setLiveConversation(scope, next);
      }
    if (shown && had.current.size > 0 && current.length === 0) {
      had.current = new Set();
      setShown(false);
      return;
    }
    const missing = wanted.filter((id) => !have.has(id));
    const spare = current.filter(
      (tab) => !wanted.includes(conversationOf(tab)),
    );
    // A spare tab takes a missing conversation (the draft, once sent).
    missing.forEach((id, i) => {
      const tab = spare[i];
      if (tab)
        updateTab(tab.id, {
          view: { ...tab.view!, state: { conversation: id } },
        });
    });
    const gone = spare.slice(missing.length).map((tab) => tab.id);
    const made = missing.slice(spare.length).map((id): DocTab => ({
      ...makeBlankTab(),
      view: {
        plugin: "textus",
        view: "ai",
        kind: "page",
        state: { conversation: id },
      },
    }));
    if (gone.length || made.length)
      setTabs((prev) => [
        ...prev.filter((tab) => !gone.includes(tab.id)),
        ...made,
      ]);
    const starting = opening.current;
    opening.current = false;
    if (made.length) {
      // Beside the AI's other tabs; the first in an island of its own on
      // the right of everything.
      const kept = current.find((tab) => !gone.includes(tab.id));
      requestAnimationFrame(() => {
        const layout = splitLayout();
        const home = kept && layout && paneWithTab(layout.root, kept.id);
        // Opened with the button, the AI is what is in use.
        if (!home && !starting) tabs.setActiveTabId(made[0].id);
        for (const tab of made) {
          if (home) moveToPane(tab.id, home.id);
          else {
            const right = layout && panesOf(layout.root).at(-1);
            openBeside(
              tab.id,
              right?.front ?? tabsRef.current[0]?.id ?? null,
              "right",
              aiShare(),
            );
          }
        }
      });
    }
    had.current = new Set(wanted);
  });

  // Titles as History names them.
  useEffect(() => {
    for (const tab of tabsRef.current.filter(isAiTab)) {
      const id = conversationOf(tab);
      const title = titles.get(id);
      if (title && tab.view?.title !== title)
        updateTab(tab.id, { view: { ...tab.view!, title } });
    }
  });

  // The tab brought to the front makes its conversation the live one.
  const front = tabsRef.current.find((tab) => tab.id === activeTabId);
  const frontConversation =
    front && isAiTab(front) ? conversationOf(front) : null;
  useEffect(() => {
    if (scope && frontConversation && frontConversation !== DRAFT)
      setLiveConversation(scope, frontConversation);
  }, [scope, frontConversation]);

  // The AI button, while shown.
  useEffect(() => {
    const press = () => {
      const ai = tabsRef.current.filter(isAiTab);
      const target =
        ai.find((tab) => conversationOf(tab) === (live ?? DRAFT)) ?? ai[0];
      if (!target) return setShown(false);
      const layout = splitLayout();
      const pane = layout && paneWithTab(layout.root, target.id);
      // In front of its island (the window's one tab, unsplit).
      const inFront = pane
        ? pane.front === target.id
        : activeTabId === target.id;
      if (!inFront) return tabs.setActiveTabId(target.id);
      // The island's tabs: a pane's, or every tab of a window not split.
      const island = pane ? pane.tabs : tabsRef.current.map((tab) => tab.id);
      const onlyAi = island.every((id) =>
        tabsRef.current.some((tab) => tab.id === id && isAiTab(tab)),
      );
      if (onlyAi) setShown(false);
    };
    window.addEventListener(AI_PRESS_EVENT, press);
    return () => window.removeEventListener(AI_PRESS_EVENT, press);
  }, [tabs, tabsRef, live, activeTabId, setShown]);

  const host =
    tabsRef.current.find(
      (tab) => isAiTab(tab) && conversationOf(tab) === (live ?? DRAFT),
    ) ?? tabsRef.current.find(isAiTab);
  return host ? aiMount(host.id) : null;
}
