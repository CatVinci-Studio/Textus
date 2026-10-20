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

/** The docked Agent panel's frame on the right (a bottom sheet on a
 *  phone). App owns the frame; the active tab's editor renders its
 *  conversation into the mount point here. */
export function AgentPanelDock({
  presence,
  closing,
  overlays,
  sheetFull,
  onSheetFullChange,
  width,
  onResize,
  onClose,
  mountRef,
  sourceMode,
  onToggleSourceMode,
  t,
}: {
  presence: PresenceHandle;
  closing: boolean;
  /** Lies over the page instead of beside it (useSidePanels). */
  overlays: boolean;
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
  t: Strings;
}) {
  return (
    <aside
      ref={presence.ref}
      aria-label={t.agentPanelTitle}
      data-state={presence.state}
      inert={closing || undefined}
      className={`agent-panel${sheetFull ? " agent-panel-sheet-full" : ""}${overlays ? " agent-panel-overlay" : ""}`}
      style={{ width }}
    >
      {/* Phone widths: the panel is a bottom sheet (mobile/styles)
        and this is its handle; hidden elsewhere. */}
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
      {/* The conversation lives in the rich editor (each tab's
        MilkdownEditor renders it here); source mode and split view
        have none to render, so say so instead of an empty column. */}
      {sourceMode && (
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
