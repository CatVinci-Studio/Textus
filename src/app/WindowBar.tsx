import { useSettings } from "../settings/SettingsContext";
import { WindowCaptionButtons } from "../ui/WindowCaptionButtons";
import type { MenuChecks } from "./app-menu-model";
import { AppMenuButton } from "./WindowControls";
import { Tooltip } from "../ui/Tooltip";
import { TextusAiButton } from "../ai/TextusAiSwitch";

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
  /** The AI panel can be opened: Textus AI is on, and so is its chat. */
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
        {dirty && (
          <Tooltip text={t.unsavedIndicator}>
            <span
              className="unsaved-dot"
              role="img"
              aria-label={t.unsavedIndicator}
            />
          </Tooltip>
        )}
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
        {/* Textus AI's one button: the AI panel, struck through while
          Textus AI is off; right-click pauses or turns it off (#196). */}
        <TextusAiButton
          className="window-bar-toggle"
          panelOpen={agentOpen}
          showPanel={showAgentToggle}
          shortcut={agentShortcut}
          onTogglePanel={onToggleAgent}
        />
      </div>
      <WindowCaptionButtons />
    </header>
  );
}
