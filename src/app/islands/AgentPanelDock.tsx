import type { PresenceHandle } from "../../engine/motion/usePresence";
import { AGENT_PANEL_DEFAULT_WIDTH } from "../../ai/chat/panel/agent-panel";
import { ResizeHandle } from "../../engine/controls/ResizeHandle";
import type { Strings } from "../../i18n/strings";
import { TextusAiOffNote } from "../../ai/TextusAiSwitch";
import { WindowConversation } from "../../ai/chat/panel/window-conversation";

/** The docked Agent panel on an iPad (a page of its own on a phone): the
 *  live conversation where the document in front is. The desktop's
 *  conversations are tabs (AiTab). */
export function AgentPanelDock({
  presence,
  closing,
  width,
  min,
  max,
  onResize,
  sourceMode,
  onToggleSourceMode,
  aiOn,
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
  /** The active tab is in source mode or split view. */
  sourceMode: boolean;
  onToggleSourceMode: () => void;
  /** Textus AI is on. A panel opened anyway (a tour lesson) offers to turn
   *  it back on. */
  aiOn: boolean;
  t: Strings;
}) {
  return (
    <aside
      ref={presence.ref}
      aria-label={t.agentPanelTitle}
      data-state={presence.state}
      inert={closing || undefined}
      className="agent-panel"
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
      <div className="agent-island">
        <div className="agent-panel-mount">
          {aiOn && !sourceMode && <WindowConversation />}
        </div>
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
