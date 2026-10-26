import { isIOSApp } from "../platform/capabilities";
import type { PresenceHandle } from "../ui/usePresence";
import {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  AgentPanelSheetGrip,
} from "../ai/chat/panel/agent-panel";
import { ResizeHandle } from "../ui/ResizeHandle";
import type { Strings } from "../i18n/strings";
import { TextusAiOffNote } from "../ai/TextusAiSwitch";

/** The docked Agent panel's frame (a bottom sheet on a phone); the active
 *  tab's editor renders its conversation into the mount point here. */
export function AgentPanelDock({
  presence,
  closing,
  sheetFull,
  onSheetFullChange,
  width,
  onResize,
  onClose,
  mountRef,
  sourceMode,
  onToggleSourceMode,
  aiOn,
  t,
}: {
  presence: PresenceHandle;
  closing: boolean;
  sheetFull: boolean;
  onSheetFullChange: (full: boolean) => void;
  width: number;
  /** `done`: the drag let go, or a key moved it - remember it. */
  onResize: (width: number, done: boolean) => void;
  onClose: () => void;
  mountRef: (el: HTMLElement | null) => void;
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
      className={`agent-panel${sheetFull ? " agent-panel-sheet-full" : ""}`}
      style={{ width }}
    >
      {/* Phone widths: the bottom sheet's handle. */}
      {isIOSApp && (
        <AgentPanelSheetGrip
          full={sheetFull}
          onFullChange={onSheetFullChange}
          onClose={onClose}
          label={t.agentPanelSheet}
        />
      )}
      <ResizeHandle
        className="agent-panel-resizer"
        edge="left"
        width={width}
        min={AGENT_PANEL_MIN_WIDTH}
        max={AGENT_PANEL_MAX_WIDTH}
        onResize={onResize}
        onReset={() => onResize(AGENT_PANEL_DEFAULT_WIDTH, true)}
        label={t.agentPanelResize}
      />
      <div className="agent-panel-mount" ref={mountRef} />
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
