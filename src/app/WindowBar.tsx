import { useSettings } from "../settings/SettingsContext";
import { AssistantIcon } from "../ui/icons";
import { WindowCaptionButtons } from "../ui/WindowCaptionButtons";
import type { MenuChecks } from "./app-menu-model";
import { AppMenuButton } from "./WindowControls";

/**
 * The window's one top strip: traffic-light room, which document this
 * is, and its status. A real row in the layout, not an overlay - the
 * overlay title bar hides the native drag area behind the webview, so
 * the app has to draw this itself, and drawing it as a transparent
 * fixed strip meant the document scrolled underneath and the filename
 * sat on top of the text. It is also the drag region (both for moving
 * the window and for the drag-to-merge gesture in useTabDragMerge).
 *
 * Where the OS supplies no frame at all (Windows), this same row is
 * ALSO the caption and the way into the app menu - the two components
 * below render nothing anywhere else, so this stays one strip on
 * every platform. See platform/window-chrome.ts.
 */
export function WindowBar({
  menuChecks,
  title,
  dirty,
  largeDoc,
  words,
  showAgentToggle,
  agentOpen,
  agentShortcut,
  onToggleAgent,
}: {
  menuChecks: MenuChecks;
  title: string;
  dirty: boolean;
  largeDoc: boolean;
  words: number;
  showAgentToggle: boolean;
  agentOpen: boolean;
  /** The AI panel's shortcut, as shown in the button's tooltip. */
  agentShortcut: string;
  onToggleAgent: () => void;
}) {
  const { t } = useSettings();
  return (
    <header className="window-bar" data-tauri-drag-region>
      <AppMenuButton checks={menuChecks} />
      {/* The unsaved dot leads the title, as a native edited-document
        title does - in the status group it sat on top of a long title
        on a narrow window. */}
      <span className="window-bar-title">
        {dirty && <span className="unsaved-dot" title={t.unsavedIndicator} />}
        <span className="window-bar-title-text">{title}</span>
      </span>
      <div className="window-bar-status">
        {largeDoc && (
          <span className="large-doc-badge" title={t.largeDocHint}>
            {t.largeDocBadge}
          </span>
        )}
        <span className="word-count">
          {words > 0 && `${words} ${t.wordsUnit}`}
        </span>
        {showAgentToggle && (
          <button
            type="button"
            className={`window-bar-toggle${agentOpen ? " window-bar-toggle-on" : ""}`}
            aria-pressed={agentOpen}
            aria-label={t.agentPanelTitle}
            title={`${t.agentPanelTitle} (${agentShortcut})`}
            onClick={onToggleAgent}
          >
            <AssistantIcon />
          </button>
        )}
      </div>
      <WindowCaptionButtons />
    </header>
  );
}
