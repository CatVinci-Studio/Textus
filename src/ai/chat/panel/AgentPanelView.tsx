import type { ReactNode } from "react";
import { DetachIcon, PlusIcon, ProjectIcon } from "../../../ui/icons";
import { Tooltip } from "../../../ui/Tooltip";

export interface AgentPanelLabels {
  title: string;
  newConversation: string;
  popOut: string;
  /** What the AI keeps for the project, behind its button. */
  project: string;
}

export type AgentPanelTab = "chat" | "memory";

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
  return (
    <section className="agent-panel-view" aria-label={labels.title}>
      <header className="agent-panel-header">
        {showingMemory && (
          <h2 className="agent-panel-heading">{labels.project}</h2>
        )}
        <div className="agent-panel-actions">
          {memory && (
            <Tooltip text={labels.project}>
              <button
                type="button"
                className="inline-chat-header-button"
                aria-label={labels.project}
                aria-pressed={showingMemory}
                onClick={() => setTab(showingMemory ? "chat" : "memory")}
              >
                <ProjectIcon />
              </button>
            </Tooltip>
          )}
          {history}
          <Tooltip text={labels.newConversation}>
            <button
              type="button"
              className="inline-chat-header-button"
              aria-label={labels.newConversation}
              onClick={() => {
                setTab("chat");
                onNewConversation();
              }}
            >
              <PlusIcon />
            </button>
          </Tooltip>
          {onPopOut && (
            <Tooltip text={labels.popOut}>
              <button
                type="button"
                className="inline-chat-header-button"
                aria-label={labels.popOut}
                onClick={onPopOut}
              >
                <DetachIcon />
              </button>
            </Tooltip>
          )}
        </div>
      </header>
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
