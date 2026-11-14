import { IconButton } from "../../../engine/controls/IconButton";
import { PanelHeader } from "../../../engine/controls/PanelHeader";
import { useEffect, type ReactNode } from "react";
import { useLatest } from "../../../utils/hooks/useLatest";
import {
  DetachIcon,
  PlusIcon,
  ProjectIcon,
} from "../../../engine/controls/icons";

interface AgentPanelLabels {
  title: string;
  newConversation: string;
  popOut: string;
  /** What the AI keeps for the project, behind its button. */
  project: string;
}

export type AgentPanelTab = "chat" | "memory";

/** Esc goes back to the conversation while Memory shows, unless something
 *  took it first (a field, a menu) or focus is elsewhere in the window. */
function useEscapeBack(on: boolean, back: () => void) {
  const latest = useLatest(back);
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const at = document.activeElement;
      if (at && at !== document.body && !at.closest(".agent-panel-view"))
        return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, latest]);
}

/**
 * The docked panel's chrome: a header row over the conversation, or over
 * the project's Memory view while its button is pressed. The conversation
 * stays mounted while Memory shows, so its scroll, draft and any arriving
 * reply stay put.
 */
export function AgentPanelView({
  labels,
  onNewConversation,
  onPopOut,
  history,
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
  /** The history button and its list. */
  history: ReactNode;
  /** The Memory view's content, drawn only while it shows. */
  memory?: () => ReactNode;
  /** What shows, kept by the panel's frame so it survives the switch to
   *  another document's editor. */
  tab: AgentPanelTab;
  onTabChange: (tab: AgentPanelTab) => void;
  children: ReactNode;
}) {
  const showingMemory = tab === "memory" && !!memory;
  useEscapeBack(showingMemory, () => setTab("chat"));
  return (
    <section className="agent-panel-view" aria-label={labels.title}>
      <PanelHeader
        className="agent-panel-header"
        actionsClassName="agent-panel-actions"
        title={
          showingMemory && (
            <h2 className="agent-panel-heading">{labels.project}</h2>
          )
        }
      >
        {memory && (
          <IconButton
            className="inline-chat-header-button"
            label={labels.project}
            pressed={showingMemory}
            onClick={() => setTab(showingMemory ? "chat" : "memory")}
          >
            <ProjectIcon />
          </IconButton>
        )}
        {history}
        <IconButton
          className="inline-chat-header-button"
          label={labels.newConversation}
          onClick={() => {
            setTab("chat");
            onNewConversation();
          }}
        >
          <PlusIcon />
        </IconButton>
        {onPopOut && (
          <IconButton
            className="inline-chat-header-button"
            label={labels.popOut}
            onClick={onPopOut}
          >
            <DetachIcon />
          </IconButton>
        )}
      </PanelHeader>
      <div className="agent-panel-body" hidden={showingMemory}>
        {children}
      </div>
      {showingMemory && (
        <div className="agent-panel-memory" aria-label={labels.project}>
          {memory()}
        </div>
      )}
    </section>
  );
}
