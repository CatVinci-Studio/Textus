import {
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MilkdownProvider } from "@milkdown/react";
import { useSettings, type AgentMode } from "../settings/SettingsContext";
import { KatexFirst } from "../editor/math/KatexFirst";
import { isIOSApp } from "../platform/capabilities";
import { isMacPlatform } from "../platform/os";
import { elasticOverscroll } from "./elastic-overscroll";
import {
  keepReadingPlace,
  placeIn,
  readingPlace,
  scrollToPlace,
} from "./reading-place";
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
 *
 * And where the file was last read (reading-place.ts): kept as it is
 * scrolled, and gone back to the first time the tab is in front - when
 * the file was opened again, switched to from the file tree or restored
 * with the session, it opened at its top (#348). Not when the reader,
 * or a link into one of its headings, has moved it first.
 */
function useKeptScroll(isActive: boolean | undefined, filePath: string | null) {
  const el = useRef<HTMLDivElement | null>(null);
  const kept = useRef(0);
  // The path now, for the scroll handler: a draft saved gets one.
  const path = useRef(filePath);
  path.current = filePath;
  // Read once, as the pane mounts with its document.
  const [lastRead] = useState(() => (filePath ? readingPlace(filePath) : null));
  const pending = useRef(lastRead);
  useEffect(() => {
    const scroller = el.current;
    if (!scroller) return;
    let timer: number | undefined;
    const save = () => {
      timer = undefined;
      const root = scroller.querySelector(".ProseMirror");
      if (!root || !path.current || scroller.clientHeight === 0) return;
      const place = placeIn(scroller, root);
      if (place) keepReadingPlace(path.current, place);
    };
    // Only while it is shown: a hidden one has nothing to say.
    const keep = () => {
      if (scroller.clientHeight === 0) return;
      kept.current = scroller.scrollTop;
      pending.current = null;
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 300);
    };
    scroller.addEventListener("scroll", keep, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", keep);
      // Closed within a moment of scrolling: kept all the same.
      if (timer !== undefined) {
        window.clearTimeout(timer);
        save();
      }
    };
  }, []);
  useLayoutEffect(() => {
    const scroller = el.current;
    if (!isActive || !scroller) return;
    if (scroller.scrollTop !== kept.current) scroller.scrollTop = kept.current;
    // Its blocks may still be on their way (a long document, the editor
    // still loading): tried each frame for two seconds.
    let frame = 0;
    let tries = 120;
    const goBack = () => {
      const place = pending.current;
      if (!place) return;
      const root = scroller.querySelector(".ProseMirror");
      if (scroller.scrollTop > 0 || tries-- <= 0) pending.current = null;
      else if (root && scrollToPlace(scroller, root, place)) {
        pending.current = null;
        kept.current = scroller.scrollTop;
      } else frame = requestAnimationFrame(goBack);
    };
    goBack();
    return () => cancelAnimationFrame(frame);
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
  const scrollRef = useKeptScroll(isActive, filePath);

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
