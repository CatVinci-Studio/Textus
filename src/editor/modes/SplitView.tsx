import { useDeferredValue, useRef } from "react";
import { SplitPreview } from "./SplitPreview";
import { useVaultLineBreaks } from "./useVaultLineBreaks";
import { DocSourceTextarea } from "./DocSourceTextarea";
import "./SplitView.css";

/**
 * Split view: editable markdown source on the left, the document as the
 * editor draws it on the right, read-only. Scrolling follows by proportion;
 * the side the user scrolls leads.
 */
export function SplitView({
  content,
  filePath,
  typewriter,
  onChange,
  readOnly,
}: {
  content: string;
  filePath: string | null;
  typewriter: boolean;
  onChange: (markdown: string) => void;
  readOnly: boolean;
}) {
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // Typing stays responsive on long documents: the preview renders the
  // deferred value and catches up a beat later.
  const deferred = useDeferredValue(content);
  const breaks = useVaultLineBreaks(filePath);

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
    <div className="split-view">
      <DocSourceTextarea
        ref={sourceRef}
        className="split-source"
        value={content}
        docPath={filePath}
        typewriter={typewriter}
        onChange={onChange}
        readOnly={readOnly}
        onScroll={(e) =>
          previewRef.current &&
          follow(e.currentTarget, previewRef.current, "source")
        }
      />
      <div
        ref={previewRef}
        className={`split-preview${breaks ? " split-preview-breaks" : ""}`}
        onScroll={(e) =>
          sourceRef.current &&
          follow(e.currentTarget, sourceRef.current, "preview")
        }
      >
        <SplitPreview markdown={deferred} filePath={filePath} />
      </div>
    </div>
  );
}
