import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { CloseIcon, DetachIcon, PlusIcon } from "../../../ui/icons";

export interface AgentPanelLabels {
  title: string;
  newConversation: string;
  popOut: string;
  close: string;
  /** The two tabs: the conversation, and what the AI keeps (MemoryView). */
  tabChat: string;
  tabMemory: string;
}

export type AgentPanelTab = "chat" | "memory";

/**
 * The docked panel's chrome: one header row - the Conversation / Memory
 * switch on the left, new / pop out / close on the right - over the chat
 * body (ChatBody, variant "full") its editor renders into `children`, or
 * the Memory view. The conversation stays mounted while Memory shows, so
 * its scroll, draft and any reply still arriving are where they were.
 * Purely presentational - the editor owns the conversation and wires the
 * actions.
 */
export function AgentPanelView({
  labels,
  onNewConversation,
  onPopOut,
  onClose,
  memory,
  tab,
  onTabChange: setTab,
  children,
}: {
  labels: AgentPanelLabels;
  onNewConversation: () => void;
  /** Absent where the chat cannot be detached into its own window (iOS):
   *  the button is not drawn. */
  onPopOut?: () => void;
  onClose: () => void;
  /** The Memory tab's content, drawn only while it shows. */
  memory?: () => ReactNode;
  /** The tab showing - kept by the panel's frame (agent-panel.tsx), so it
   *  survives the switch to another document's editor. */
  tab: AgentPanelTab;
  onTabChange: (tab: AgentPanelTab) => void;
  children: ReactNode;
}) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<CSSProperties>({});
  // The sliding pill behind the selected tab: measured, so it fits each
  // language's words.
  useLayoutEffect(() => {
    const on = tabsRef.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    if (on)
      setThumb({
        width: on.offsetWidth,
        transform: `translateX(${on.offsetLeft - 2}px)`,
      });
  }, [tab, labels.tabChat, labels.tabMemory]);
  const tabButton = (id: AgentPanelTab, label: string) => (
    <button
      type="button"
      role="tab"
      id={`agent-tab-${id}`}
      aria-selected={tab === id}
      aria-controls={`agent-tabpanel-${id}`}
      tabIndex={tab === id ? 0 : -1}
      onClick={() => setTab(id)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const next = id === "chat" ? "memory" : "chat";
          setTab(next);
          tabsRef.current
            ?.querySelector<HTMLElement>(`#agent-tab-${next}`)
            ?.focus();
        }
      }}
    >
      {label}
    </button>
  );
  return (
    <section className="agent-panel-view" aria-label={labels.title}>
      <header className="agent-panel-header" data-tauri-drag-region>
        <div
          className="agent-panel-tabs"
          role="tablist"
          aria-label={labels.title}
          ref={tabsRef}
        >
          <span className="agent-panel-tabs-thumb" style={thumb} />
          {tabButton("chat", labels.tabChat)}
          {memory && tabButton("memory", labels.tabMemory)}
        </div>
        <div className="agent-panel-actions">
          <button
            type="button"
            className="inline-chat-header-button"
            aria-label={labels.newConversation}
            title={labels.newConversation}
            onClick={() => {
              setTab("chat");
              onNewConversation();
            }}
          >
            <PlusIcon />
          </button>
          {onPopOut && (
            <button
              type="button"
              className="inline-chat-header-button"
              aria-label={labels.popOut}
              title={labels.popOut}
              onClick={onPopOut}
            >
              <DetachIcon />
            </button>
          )}
          <button
            type="button"
            className="inline-chat-header-button"
            aria-label={labels.close}
            title={labels.close}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
      </header>
      <div
        className="agent-panel-body"
        id="agent-tabpanel-chat"
        role="tabpanel"
        aria-labelledby="agent-tab-chat"
        hidden={tab !== "chat"}
      >
        {children}
      </div>
      {tab === "memory" && memory && (
        <div
          className="agent-panel-memory"
          id="agent-tabpanel-memory"
          role="tabpanel"
          aria-labelledby="agent-tab-memory"
        >
          {memory()}
        </div>
      )}
    </section>
  );
}
