import {
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useSettings, type AgentMode } from "../prefs/SettingsContext";
import { KatexFirst } from "../editor/math/KatexFirst";
import { elasticOverscroll } from "../engine/controls/elastic-overscroll";
import { placeIn, scrollToPlace } from "./reading-place";
import { lastScroll, rememberScroll } from "../document/last-places";
import { windowTabs } from "../engine/layout/store";
import type { DocTab } from "../document/doc-tabs";
import type { TourAi } from "../utils/events";
import { lazyModule } from "../lazy/lazy-module";
import { lazyComponent } from "../lazy/lazy-component";

// The editor loads with the first document shown, or first once the window
// is idle, so opening a document doesn't wait on it.
const MilkdownEditor = lazyComponent(
  lazyModule("editor", () => import("./MilkdownEditor"), { warm: "first" }),
  (m) => m.ProvidedEditor,
);

interface EditorPaneProps {
  /** The owning tab. */
  tabId: string;
  filePath: string | null;
  /** Read once, at mount; a reload remounts the pane. */
  initialValue: string;
  /** Stable across renders: it takes the tab id rather than closing over
   *  it, so memo isn't defeated. */
  onChange: (tabId: string, markdown: string) => void;
  /** The tab's display name, for the chat window title. */
  docTitle: string;
  /** Whether this is the tab the user is looking at. */
  isActive?: boolean;
  /** The tour's AI, on its practice tab. */
  tour?: TourAi | null;
  /** The tour's AI panel mode, on its practice tab. */
  tourMode?: AgentMode | null;
  /** View › Read Only, for this tab. */
  readOnly?: boolean;
}

/**
 * Every edit re-renders App; only `initialValue` changes, and the editor
 * never reads it after mount, so it is left out to spare hidden tabs.
 */
function sameProps(prev: EditorPaneProps, next: EditorPaneProps): boolean {
  return (Object.keys(next) as (keyof EditorPaneProps)[]).every(
    (key) => key === "initialValue" || prev[key] === next[key],
  );
}

/** The modified time of tab `tabId`'s file as it was read, or null. */
const mtimeOf = (tabId: string) =>
  windowTabs<DocTab>().find((tab) => tab.id === tabId)?.diskMtime ?? null;

/**
 * Restores the tab's scroll when it comes back to the front: WebKit resets
 * a display: none scroller to the top. Also returns a reopened file to where
 * it was last read, unless the reader or a link moved it first.
 */
function useKeptScroll(
  isActive: boolean | undefined,
  tabId: string,
  filePath: string | null,
) {
  const el = useRef<HTMLDivElement | null>(null);
  const kept = useRef(0);
  // The path now, for the scroll handler: a saved draft gets one.
  const path = useRef(filePath);
  path.current = filePath;
  // Read once, as the pane mounts with its document.
  const [lastRead] = useState(() =>
    filePath ? lastScroll(filePath, mtimeOf(tabId)) : null,
  );
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
      const mtime = mtimeOf(tabId);
      if (place && mtime !== null) rememberScroll(path.current, place, mtime);
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
  }, [tabId]);
  useLayoutEffect(() => {
    const scroller = el.current;
    if (!isActive || !scroller) return;
    if (scroller.scrollTop !== kept.current) scroller.scrollTop = kept.current;
    // Its blocks may still be loading: tried each frame for two seconds.
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
  // A Mac's page gives at either end, short documents too. The iPhone's web
  // view stretches by itself.
  useEffect(() => {
    const scroller = el.current;
    const content = scroller?.firstElementChild;
    if (!scroller || !(content instanceof HTMLElement)) return;
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
  readOnly,
}: EditorPaneProps) {
  // No file yet: still an editable blank canvas. The path is not a remount
  // key, since saving or renaming is the same document and a remount drops
  // undo history and pending edits; new content bumps reloadKey instead.
  const { settings } = useSettings();
  const handleChange = useCallback(
    (markdown: string) => onChange(tabId, markdown),
    [onChange, tabId],
  );
  const scrollRef = useKeptScroll(isActive, tabId, filePath);

  return (
    <div className="editor-scroll tx-scroll-reveal" ref={scrollRef}>
      <div
        className={`editor-content ${settings.typewriterMode ? "typewriter-active" : ""}`}
      >
        <Suspense fallback={null}>
          <KatexFirst markdown={initialValue}>
            <MilkdownEditor
              tabId={tabId}
              filePath={filePath}
              docTitle={docTitle}
              initialValue={initialValue}
              onChange={handleChange}
              isActive={isActive}
              tour={tour}
              tourMode={tourMode}
              readOnly={readOnly}
            />
          </KatexFirst>
        </Suspense>
      </div>
    </div>
  );
}, sameProps);
