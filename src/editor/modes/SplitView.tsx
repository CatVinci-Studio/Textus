import { useDeferredValue, useEffect, useRef } from "react";
import { SplitPreview } from "./SplitPreview";
import { useVaultLineBreaks } from "./useVaultLineBreaks";
import { DocSourceEditor } from "./lazy-doc-source-editor";
import { elasticOverscroll } from "../../engine/controls/elastic-overscroll";
import "./SplitView.css";

/**
 * Split view: editable markdown source on the left, the document as the
 * editor draws it on the right, read-only. Scrolling follows by proportion;
 * the side the user scrolls leads.
 */
export function SplitView({
  tabId,
  content,
  filePath,
  typewriter,
  onChange,
  readOnly,
}: {
  tabId: string;
  content: string;
  filePath: string | null;
  typewriter: boolean;
  onChange: (markdown: string) => void;
  readOnly: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const sourceScroller = () =>
    rootRef.current?.querySelector<HTMLElement>(".split-source .cm-scroller") ??
    null;
  // Typing stays responsive on long documents: the preview renders the
  // deferred value and catches up a beat later.
  const deferred = useDeferredValue(content);
  const breaks = useVaultLineBreaks(filePath);
  // The preview gives at either end as the source beside it does, on a Mac.
  useEffect(() => {
    const preview = previewRef.current;
    const content = preview?.firstElementChild;
    if (!preview || !(content instanceof HTMLElement)) return;
    return elasticOverscroll(preview, content);
  }, []);

  // The scrollTop each side was last moved to by the other. Its scroll event
  // can arrive frames later (WebKitGTK), so it is matched by position, not a
  // one-frame guard, to keep it from steering the user's side back.
  const echo = useRef<{ source: number | null; preview: number | null }>({
    source: null,
    preview: null,
  });
  function follow(
    from: HTMLElement,
    to: HTMLElement,
    side: "source" | "preview",
  ) {
    const expected = echo.current[side];
    echo.current[side] = null;
    if (expected !== null && Math.abs(from.scrollTop - expected) < 2) return;
    const range = from.scrollHeight - from.clientHeight;
    const ratio = range > 0 ? from.scrollTop / range : 0;
    const target = Math.round(ratio * (to.scrollHeight - to.clientHeight));
    const before = to.scrollTop;
    if (Math.abs(before - target) < 1) return;
    to.scrollTop = target;
    // Read back: clamped at either end, or rounded to a device pixel.
    if (to.scrollTop !== before)
      echo.current[side === "source" ? "preview" : "source"] = to.scrollTop;
  }

  return (
    <div ref={rootRef} className="split-view">
      <div className="split-view-panes">
        <DocSourceEditor
          className="split-source"
          tabId={tabId}
          value={content}
          docPath={filePath}
          typewriter={typewriter}
          onChange={onChange}
          readOnly={readOnly}
          onScroll={(scroller) =>
            previewRef.current && follow(scroller, previewRef.current, "source")
          }
        />
        <div
          ref={previewRef}
          className={`split-preview tx-scroll-reveal${breaks ? " split-preview-breaks" : ""}`}
          onScroll={(e) => {
            const source = sourceScroller();
            if (source) follow(e.currentTarget, source, "preview");
          }}
        >
          <SplitPreview markdown={deferred} filePath={filePath} />
        </div>
      </div>
    </div>
  );
}
