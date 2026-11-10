import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  DRAFT,
  closeConversation,
  liveConversation,
  onLiveConversation,
  onOpenConversations,
  openConversations,
  setLiveConversation,
} from "../../ai/chat/conversation-scope";
import { useChatHistory } from "../../ai/chat/chat-history";
import { makeBlankTab, type DocTab } from "../../document/doc-tabs";
import {
  besideLayout,
  placeOnArrival,
  splitLayout,
} from "../../engine/layout/store";
import { moveTab, splitOff } from "../../engine/layout/ops";
import { paneWithTab } from "../../engine/layout/tree";
import type { TabState } from "../tabs/useTabState";
import { pageOf } from "../tabs/page-tabs";
import { AI_PRESS_EVENT, conversationIn } from "./ai-tabs";

const NONE: string[] = [];

const conversationOf = (tab: DocTab) => conversationIn(tab.view?.state);

const isAiTab = (tab: DocTab) => pageOf(tab) === "ai";

/**
 * The AI's conversations as tabs (desktop): while the AI is shown, one tab
 * per conversation open in the folder (a draft's while none is), first in
 * an island of their own on the right, then wherever they are dragged.
 * Closing one closes its conversation; closing the last hides the AI. The
 * tab brought to the front makes its conversation the live one; each tab
 * draws its own (AiTab).
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
}): void {
  const open = useSyncExternalStore(onOpenConversations, () =>
    scope ? openConversations(scope) : NONE,
  );
  const live = useSyncExternalStore(
    (changed) => onLiveConversation(() => changed()),
    () => (scope ? liveConversation(scope) : null),
  );
  const history = useChatHistory();
  const had = useRef<ReadonlySet<string>>(new Set());
  // The window's first tabs: shown as it opens, the document stays in use.
  const opening = useRef(true);

  const wanted = !shown ? NONE : open.length ? open : [live ?? DRAFT];
  const titles = new Map(history.map((entry) => [entry.id, entry.title]));
  const { tabsRef, setTabs, updateTab, activeTabId } = tabs;
  const activeNow = useRef(activeTabId);
  activeNow.current = activeTabId;

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
      // The tab in use stays in front where the AI opens beside it.
      const inUse = activeNow.current;
      // Each placed as it arrives, in the same update as it is added.
      const layout = splitLayout();
      const home = kept && layout && paneWithTab(layout.root, kept.id);
      // Opened with the button, the AI is what is in use.
      if (!home && !starting) tabs.setActiveTabId(made[0].id);
      const windowTabs = tabsRef.current.map((t) => t.id);
      for (const tab of made)
        placeOnArrival(tab.id, (now) =>
          home
            ? ((now && moveTab(now, tab.id, home.id)) ?? now)
            : now
              ? // A window already split: a column of its own at the right
                // of all of it, not beside whichever island came last.
                (splitOff(now, tab.id, null, "right") ?? now)
              : besideLayout(
                  now,
                  tab.id,
                  inUse ?? windowTabs[0] ?? null,
                  "right",
                  undefined,
                  windowTabs,
                ),
        );
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
}
