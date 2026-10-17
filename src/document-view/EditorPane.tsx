import { lazy, memo, Suspense, useCallback } from "react";
import { MilkdownProvider } from "@milkdown/react";
import { useSettings } from "../settings/SettingsContext";

const MilkdownEditor = lazy(() =>
  import("./MilkdownEditor").then((m) => ({ default: m.MilkdownEditor })),
);

interface EditorPaneProps {
  /** See MilkdownEditor: the owning tab, for editor-flush.ts. */
  tabId: string;
  documentId?: string;
  filePath: string | null;
  /** Read once, at mount (a reload remounts via the key in App.tsx), so
   *  changes alone don't re-render the pane - see `sameProps` below. */
  initialValue: string;
  /** Stable across renders (App's handleChange): it takes the tab id rather
   *  than closing over it, so memo isn't defeated by a fresh arrow. */
  onChange: (tabId: string, markdown: string) => void;
  /** See MilkdownEditor: the tab's display name, for the chat window title. */
  docTitle: string;
  /** See MilkdownEditor: whether this is the tab the user is looking at. */
  isActive?: boolean;
  /** See MilkdownEditor: onboarding tour running, real AI muted/mocked. */
  tutorialMock?: boolean;
  /** Bundled guides already contain text, but that is not the user's first
   * writing action and must not trigger contextual onboarding bubbles. */
}

/**
 * Every edit lands in App's `tabs` state and re-renders App, which used to
 * re-render every open tab's editor, hidden ones included, after each
 * typing pause. Only `initialValue` changes on an edit, and the editor
 * never reads it after mounting, so it is the one prop left out here.
 */
function sameProps(prev: EditorPaneProps, next: EditorPaneProps): boolean {
  return (Object.keys(next) as (keyof EditorPaneProps)[]).every(
    (key) => key === "initialValue" || prev[key] === next[key],
  );
}

export const EditorPane = memo(function EditorPane({
  tabId,
  documentId,
  filePath,
  docTitle,
  initialValue,
  onChange,
  isActive,
  tutorialMock,
}: EditorPaneProps) {
  // No file open yet -> still show an editable blank canvas (draft mode).
  // The path is NOT a remount key: saving a draft or renaming the file is
  // the same document, and remounting dropped its undo history, the Agent
  // conversation and any pending edits (with the request left running).
  // Loading different content into the tab bumps the tab's reloadKey
  // instead (App.tsx), which remounts this whole pane.
  const { settings } = useSettings();
  const handleChange = useCallback(
    (markdown: string) => onChange(tabId, markdown),
    [onChange, tabId],
  );

  return (
    <div className="editor-scroll">
      <div
        className={`editor-content ${settings.typewriterMode ? "typewriter-active" : ""}`}
      >
        <Suspense fallback={null}>
          <MilkdownProvider>
            <MilkdownEditor
              tabId={tabId}
              documentId={documentId}
              filePath={filePath}
              docTitle={docTitle}
              initialValue={initialValue}
              onChange={handleChange}
              isActive={isActive}
              tutorialMock={tutorialMock}
            />
          </MilkdownProvider>
        </Suspense>
      </div>
    </div>
  );
}, sameProps);
