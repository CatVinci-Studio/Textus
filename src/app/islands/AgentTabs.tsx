import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { TabBar } from "../../engine/controls/tabs/TabBar";
import {
  DRAFT,
  closeConversation,
  liveConversation,
  onLiveConversation,
  onOpenConversations,
  openConversations,
  reorderConversation,
  setLiveConversation,
} from "../../ai/chat/conversation-scope";
import { useChatHistory } from "../../ai/chat/chat-history";
import { ChatHistoryMenu } from "../../ai/chat/ChatHistoryMenu";
import { reopenConversation } from "../../ai/chat/reopen-conversation";
import { useAgentPanel } from "../../ai/chat/panel/agent-panel";
import {
  ContextMenu,
  type ContextMenuItem,
} from "../../engine/controls/ContextMenu";
import { Presence } from "../../engine/motion/usePresence";
import { IconButton } from "../../engine/controls/IconButton";
import { PlusIcon } from "../../engine/controls/icons";
import type { Strings } from "../../i18n/strings";

const NONE: string[] = [];

function useOpen(scope: string | null): string[] {
  return useSyncExternalStore(onOpenConversations, () =>
    scope ? openConversations(scope) : NONE,
  );
}

function useLive(scope: string | null): string | null {
  return useSyncExternalStore(
    (changed) => onLiveConversation(() => changed()),
    () => (scope ? liveConversation(scope) : null),
  );
}

/**
 * The AI island's tabs, for its row (IslandRow), in the window bar's row
 * over it: a tab a conversation open in this folder, + a new one, the window's
 * own tab bar for all the rest - order, close, menu; those past its room
 * list behind the row's own button (TabBar). Only the detached chat
 * window has it now (the window's AI is a tab of its islands): it passes
 * its own new conversation and end buttons, and keeps no memory view, so a
 * tab's menu only starts a conversation. `scope` is the folder
 * (conversation-scope); a draft never saved has one conversation and no
 * tabs to keep.
 */
export function AgentTabs({
  scope,
  onNew,
  end,
  t,
}: {
  scope: string | null;
  onNew: () => void;
  end?: ReactNode;
  t: Strings;
}) {
  const open = useOpen(scope);
  const live = useLive(scope);
  const history = useChatHistory();
  const panel = useAgentPanel();
  const titles = new Map(history.map((entry) => [entry.id, entry.title]));
  const ids = open.length ? open : live ? [live] : [DRAFT];
  const title = (id: string) => titles.get(id) || t.chatNewConversation;
  const show = (id: string) => {
    panel.setTab("chat");
    if (scope) setLiveConversation(scope, id);
  };
  return (
    <>
      <TabBar
        tabs={ids.map((id) => ({ id, title: title(id), dirty: false }))}
        activeTabId={live ?? DRAFT}
        onActivate={(id) => (id === DRAFT ? panel.setTab("chat") : show(id))}
        onClose={(id) => {
          if (!scope || id === DRAFT) return;
          const next = closeConversation(scope, id);
          if (id !== live) return;
          if (next) show(next);
          else onNew();
        }}
        onAdd={() => {
          panel.setTab("chat");
          onNew();
        }}
        onReorder={(id, index) =>
          scope && reorderConversation(scope, id, index)
        }
        previewTab={null}
        menuFor={() => [{ label: t.chatNewConversation, onSelect: onNew }]}
        labels={{
          tabs: t.agentPanelTitle,
          close: t.menuCloseTab,
          add: t.chatNewConversation,
          unsaved: t.unsavedIndicator,
          all: t.menuAllTabs,
        }}
      />
      {end && <div className="agent-tabs-actions">{end}</div>}
    </>
  );
}

/** The AI island's own menu - on its tabs, and on its empty paper: a new
 *  conversation, and what the AI keeps for the folder. */
function agentIslandMenu(
  t: Strings,
  setTab: (tab: "chat" | "memory") => void,
  onNew: () => void,
): ContextMenuItem[] {
  return [
    {
      label: t.chatNewConversation,
      onSelect: () => {
        setTab("chat");
        onNew();
      },
    },
    { label: t.agentTabProject, onSelect: () => setTab("memory") },
  ];
}

/** Inside the island: New conversation and History at the top right, and its menu on a
 *  right-click on its paper (not on a message, a control or a selection,
 *  which keep their own). */
export function AgentIslandTools({
  t,
  onNew,
}: {
  t: Strings;
  onNew: () => void;
}) {
  const panel = useAgentPanel();
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const island = ref.current?.parentElement;
    if (!island) return;
    const onMenu = (e: MouseEvent) => {
      const target = e.target as Element;
      if (
        target.closest(OWN_MENUS) ||
        (getSelection()?.toString() ?? "") !== ""
      )
        return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    };
    island.addEventListener("contextmenu", onMenu);
    return () => island.removeEventListener("contextmenu", onMenu);
  }, []);
  return (
    <div className="agent-island-tools" ref={ref}>
      <IconButton
        className="inline-chat-header-button"
        label={t.chatNewConversation}
        onClick={() => {
          panel.setTab("chat");
          onNew();
        }}
      >
        <PlusIcon />
      </IconButton>
      <ChatHistoryMenu
        buttonClassName="inline-chat-header-button"
        onReopen={(entry) => void reopenConversation(entry, t)}
      />
      <Presence show={menu !== null}>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={agentIslandMenu(t, panel.setTab, onNew)}
            onClose={() => setMenu(null)}
          />
        )}
      </Presence>
    </div>
  );
}

/** What keeps its own right-click inside the island. */
const OWN_MENUS =
  "button, a, input, textarea, [contenteditable], .inline-chat-messages > *, .agent-panel-memory";
