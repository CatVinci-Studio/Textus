import {
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { MilkdownProvider } from "@milkdown/react";
import { useSettings, type AgentMode } from "../settings/SettingsContext";
import { KatexFirst } from "../editor/math/KatexFirst";
import { isIOSApp } from "../platform/capabilities";
import { isMacPlatform } from "../platform/os";
import { elasticOverscroll } from "./elastic-overscroll";
import type { TourAi } from "../utils/events";
import { lazyModule } from "../lazy/lazy-module";
import { lazyComponent } from "../lazy/lazy-component";

// The editor - ProseMirror, the markdown pipeline, the AI panel - loads with
// the first document shown (lazy-module.ts).
const MilkdownEditor = lazyComponent(
  lazyModule("editor", () => import("./MilkdownEditor")),
  (m) => m.MilkdownEditor,
);

interface EditorPaneProps {
  /** See MilkdownEditor: the owning tab, for editor-flush.ts. */
  tabId: string;
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
  /** See MilkdownEditor: the tour's AI, on its practice tab. */
  tour?: TourAi | null;
  /** See MilkdownEditor: the tour's AI panel mode, on its practice tab. */
  tourMode?: AgentMode | null;
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

/**
 * Where the tab's scroller was while it was in front, put back when it
 * comes to the front again. A tab in the back is display: none
 * (MainPane.tsx); Chromium keeps a hidden scroller's position, WebKit
 * (WebKitGTK, WKWebView) sets it back to the top, and a tab switched
 * away from and back to opened at its first line.
 */
function useKeptScroll(isActive: boolean | undefined) {
  const el = useRef<HTMLDivElement | null>(null);
  const kept = useRef(0);
  useEffect(() => {
    const scroller = el.current;
    if (!scroller) return;
    // Only while it is shown: a hidden one has nothing to say.
    const keep = () => {
      if (scroller.clientHeight > 0) kept.current = scroller.scrollTop;
    };
    scroller.addEventListener("scroll", keep, { passive: true });
    return () => scroller.removeEventListener("scroll", keep);
  }, []);
  useLayoutEffect(() => {
    const scroller = el.current;
    if (isActive && scroller && scroller.scrollTop !== kept.current)
      scroller.scrollTop = kept.current;
  }, [isActive]);
  // A Mac's page gives at either end, short documents too
  // (elastic-overscroll.ts). The iPhone's web view stretches by itself.
  useEffect(() => {
    const scroller = el.current;
    const content = scroller?.firstElementChild;
    if (!scroller || !(content instanceof HTMLElement)) return;
    if (!isMacPlatform() || isIOSApp) return;
    return elasticOverscroll(scroller, content);
  }, []);
  return el;
}

export const EditorPane = memo(function EditorPane({
  tabId,
  filePath,
  docTitle,
  initialValue,
  onChange,
  isActive,
  tour,
  tourMode,
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
  const scrollRef = useKeptScroll(isActive);

  return (
    <div className="editor-scroll" ref={scrollRef}>
      <div
        className={`editor-content ${settings.typewriterMode ? "typewriter-active" : ""}`}
      >
        <Suspense fallback={null}>
          <KatexFirst markdown={initialValue}>
            <MilkdownProvider>
              <MilkdownEditor
                tabId={tabId}
                filePath={filePath}
                docTitle={docTitle}
                initialValue={initialValue}
                onChange={handleChange}
                isActive={isActive}
                tour={tour}
                tourMode={tourMode}
              />
            </MilkdownProvider>
          </KatexFirst>
        </Suspense>
      </div>
    </div>
  );
}, sameProps);
