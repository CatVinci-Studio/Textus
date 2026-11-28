import {
  memo,
  Suspense,
  type RefObject,
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
import {
  leaveReading,
  leftBy,
  readingLeft,
  type Reading,
} from "../editor/tab-left";
import { whenEditorBuilt } from "../editor/tab-editor";
import { lastScroll, rememberScroll } from "../document/last-places";
import { windowTabs } from "../engine/layout/store";
import type { DocTab } from "../document/doc-tabs";
import type { TourAi } from "../utils/events";
import { lazyModule } from "../lazy/lazy-module";
import { lazyComponent } from "../lazy/lazy-component";
import { useDocEndRef } from "./doc-end";
import { registerZoomPane } from "../engine/zoom/zoom-panes";

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
 * Where the tab is read. Shown again while its editor was kept, the scroll
 * is put back (WebKit resets a display: none scroller to the top). With a
 * new editor it goes back where the tab's last one was read, or a reopened
 * file where it was read last time - unless the reader or a link moved it
 * first.
 */
function useKeptScroll(
  isActive: boolean | undefined,
  tabId: string,
  filePath: string | null,
  content: string,
) {
  const el = useRef<HTMLDivElement | null>(null);
  // Read once, as the pane mounts with its document.
  const [opened] = useState<Reading | null>(() => {
    if (leftBy(tabId, content)) return readingLeft(tabId);
    const place = filePath ? lastScroll(filePath, mtimeOf(tabId)) : null;
    return place && { top: 0, width: 0, place };
  });
  // As it is read now, taken while it is shown and laid out: by the time
  // the editor goes, its tab is already drawn as one out of sight.
  const reading = useRef<Reading>(opened ?? { top: 0, width: 0, place: null });
  const pending = useRef(opened);
  const saveNow = useReadingFollowed(el, tabId, filePath, reading, pending);
  // Left for the tab's next editor as this pane goes.
  useLayoutEffect(
    () => () => {
      saveNow.current();
      leaveReading(tabId, reading.current);
    },
    [tabId, saveNow],
  );
  useLayoutEffect(() => {
    const scroller = el.current;
    // Shown is enough, in whichever island: only one kept out of sight
    // waits to come back.
    if (!scroller || (!isActive && scroller.clientHeight === 0)) return;
    const goBack = () => {
      const to = pending.current;
      const root = scroller.querySelector(".ProseMirror");
      if (!to || !root) return;
      pending.current = null;
      // The same document at the same width reads at the same offset;
      // otherwise by the block that was at the top.
      if (to.width === scroller.clientWidth) scroller.scrollTop = to.top;
      else if (to.place) scrollToPlace(scroller, root, to.place);
      reading.current = {
        ...to,
        top: scroller.scrollTop,
        width: scroller.clientWidth,
      };
    };
    // Its cleanup runs while the pane is still drawn, before it is hidden.
    const leaving = () => saveNow.current();
    if (pending.current) {
      goBack();
      if (!pending.current) return leaving;
      const cancel = whenEditorBuilt(tabId, goBack);
      return () => {
        cancel();
        leaving();
      };
    }
    const { top } = reading.current;
    if (scroller.scrollTop !== top) scroller.scrollTop = top;
    return leaving;
  }, [isActive, tabId, saveNow]);
  return el;
}

/** The reading followed as the reader scrolls, its place taken a pause
 *  after (the place is dearer to read than the offset). Returns what takes
 *  a place still to be taken now, as the pane goes out of sight. */
function useReadingFollowed(
  el: RefObject<HTMLDivElement | null>,
  tabId: string,
  filePath: string | null,
  reading: RefObject<Reading>,
  pending: RefObject<Reading | null>,
): RefObject<() => void> {
  // The path now, for the scroll handler: a saved draft gets one.
  const path = useRef(filePath);
  path.current = filePath;
  const saveNow = useRef(() => {});
  useEffect(() => {
    const scroller = el.current;
    if (!scroller) return;
    let timer: number | undefined;
    const save = () => {
      window.clearTimeout(timer);
      timer = undefined;
      const root = scroller.querySelector(".ProseMirror");
      if (!root || scroller.clientHeight === 0) return;
      const place = placeIn(scroller, root);
      reading.current = { ...reading.current, place };
      const mtime = mtimeOf(tabId);
      if (place && path.current && mtime !== null)
        rememberScroll(path.current, place, mtime);
    };
    // Only while it is shown: a hidden one has nothing to say.
    const keep = () => {
      // A scroll the new width made is the observer's below to answer.
      if (
        scroller.clientHeight === 0 ||
        (reading.current.width &&
          scroller.clientWidth !== reading.current.width)
      )
        return;
      reading.current = {
        ...reading.current,
        top: scroller.scrollTop,
        width: scroller.clientWidth,
      };
      pending.current = null;
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 300);
    };
    // A new width (the device turned, an island resized) rewraps the
    // text: the block that was at the top stays there, not the offset.
    const rewrapped = new ResizeObserver(() => {
      const { width, place } = reading.current;
      const root = scroller.querySelector(".ProseMirror");
      if (scroller.clientHeight === 0 || scroller.clientWidth === width) return;
      if (place && root && width && !pending.current)
        scrollToPlace(scroller, root, place);
      reading.current = {
        ...reading.current,
        top: scroller.scrollTop,
        width: scroller.clientWidth,
      };
    });
    rewrapped.observe(scroller);
    scroller.addEventListener("scroll", keep, { passive: true });
    saveNow.current = () => {
      if (timer !== undefined) save();
    };
    return () => {
      rewrapped.disconnect();
      scroller.removeEventListener("scroll", keep);
      window.clearTimeout(timer);
    };
  }, [el, tabId, reading, pending]);
  return saveNow;
}

/** A Mac's page gives at either end, short documents too. The iPhone's web
 *  view stretches by itself. */
function useElasticPage(el: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const scroller = el.current;
    const content = scroller?.firstElementChild;
    if (!scroller || !(content instanceof HTMLElement)) return;
    return elasticOverscroll(scroller, content);
  }, [el]);
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
  const scrollRef = useKeptScroll(isActive, tabId, filePath, initialValue);
  useElasticPage(scrollRef);
  const endRef = useDocEndRef(tabId);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    return registerZoomPane(tabId, {
      kind: "rendered",
      scroller,
      content: () => scroller.querySelector(".milkdown"),
    });
  }, [tabId, scrollRef]);

  return (
    // The column held where it was as the island changes width (carry.ts).
    <div
      className="editor-scroll tx-scroll-reveal"
      ref={scrollRef}
      data-frame-carry=""
    >
      <div
        data-frame-column=""
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
        <div className="doc-end" ref={endRef} />
      </div>
    </div>
  );
}, sameProps);
