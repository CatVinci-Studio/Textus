import type { PresenceHandle } from "../ui/usePresence";
import { AGENT_PANEL_DEFAULT_WIDTH } from "../ai/chat/panel/agent-panel";
import { ResizeHandle } from "../ui/ResizeHandle";
import type { Strings } from "../i18n/strings";
import { TextusAiOffNote } from "../ai/TextusAiSwitch";
import { AgentIslandTools, AgentTabs } from "./AgentTabs";

/** The docked Agent panel's frame - the AI island: its row of
 *  conversations over its sheet (a page of its own on a phone); the active
 *  tab's editor renders its conversation into the mount point here. */
export function AgentPanelDock({
  presence,
  closing,
  width,
  min,
  max,
  onResize,
  mountRef,
  sourceMode,
  onToggleSourceMode,
  aiOn,
  conversations,
  t,
}: {
  presence: PresenceHandle;
  closing: boolean;
  width: number;
  /** How far it may be dragged in this window. */
  min: number;
  max: number;
  /** `done`: the drag let go, or a key moved it - remember it. */
  onResize: (width: number, done: boolean) => void;
  mountRef: (el: HTMLElement | null) => void;
  /** The active tab is in source mode or split view. */
  sourceMode: boolean;
  onToggleSourceMode: () => void;
  /** Textus AI is on. A panel opened anyway (a tour lesson) offers to turn
   *  it back on. */
  aiOn: boolean;
  /** The folder whose conversations its row of tabs shows; undefined
   *  draws no row (iOS keeps the panel's own header). */
  conversations?: string | null;
  t: Strings;
}) {
  return (
    <aside
      ref={presence.ref}
      aria-label={t.agentPanelTitle}
      data-state={presence.state}
      inert={closing || undefined}
      className="agent-panel"
      data-tabbed={(conversations !== undefined && aiOn) || undefined}
      // The AI island is one in any window, a clean sheet's too.
      data-islands={conversations !== undefined || undefined}
      style={{ width }}
    >
      <ResizeHandle
        className="agent-panel-resizer"
        edge="left"
        width={width}
        min={min}
        max={max}
        onResize={onResize}
        onReset={() => onResize(AGENT_PANEL_DEFAULT_WIDTH, true)}
        label={t.agentPanelResize}
      />
      {conversations !== undefined && aiOn && (
        <AgentTabs scope={conversations} t={t} />
      )}
      <div className="agent-island" data-island="">
        <div className="agent-panel-mount" ref={mountRef} />
        {conversations !== undefined && aiOn && <AgentIslandTools t={t} />}
      </div>
      {/* Source mode, split view and AI off have no conversation, so say so
        instead of an empty column. */}
      {!aiOn && <TextusAiOffNote className="agent-panel-placeholder" />}
      {aiOn && sourceMode && (
        <div className="agent-panel-placeholder">
          <p>{t.agentPanelSourceMode}</p>
          <button
            type="button"
            className="text-button"
            onClick={onToggleSourceMode}
          >
            {t.agentPanelBackToEditor}
          </button>
        </div>
      )}
    </aside>
  );
}
