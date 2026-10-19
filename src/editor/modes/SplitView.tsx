import { useDeferredValue, useEffect, useMemo, useRef } from "react";
import { renderDocumentHtml } from "../markdown/render-html";
import { resolveImageSrc } from "../images/image-plugin";
import { diagramRenderer } from "../diagram-engine";
import { useSettings } from "../../settings/SettingsContext";
import { SourceTextarea } from "./SourceTextarea";
import "./SplitView.css";

/**
 * Split view: the markdown source on the left, editable, and the rendered
 * document on the right - for people who think in markdown but want to see
 * the result. The preview is rendered from the source (renderDocumentHtml)
 * inside the editor's content classes, so the same theme styles it.
 *
 * Scrolling is kept in step by proportion; the side being scrolled by the
 * user leads, and the scroll event the follower then fires is recognized by
 * its position and not echoed back. With typewriter mode on, the source keeps the caret's line in the
 * middle the way the rich editor does.
 */
export function SplitView({
  content,
  filePath,
  typewriter,
  onChange,
}: {
  content: string;
  filePath: string | null;
  typewriter: boolean;
  onChange: (markdown: string) => void;
}) {
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // Typing stays responsive on long documents: the preview renders the
  // deferred value and catches up a beat later.
  const deferred = useDeferredValue(content);
  const html = useMemo(() => renderDocumentHtml(deferred), [deferred]);
  const { diagramEngine } = useSettings().settings;

  // Relative image paths resolve against the document's folder, as in the
  // editor; Mermaid fences become diagrams (loaded only when present).
  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    for (const img of root.querySelectorAll("img")) {
      const src = img.getAttribute("src");
      if (src) img.src = resolveImageSrc(src, filePath);
    }
    const diagrams = root.querySelectorAll<HTMLElement>(
      "pre > code.language-mermaid",
    );
    if (diagrams.length === 0) return;
    let cancelled = false;
    // The editor's own engines and settings: mermaid is one global, so a
    // second initialize() of other settings here would reset the editor's
    // diagrams too.
    const draw = diagramRenderer(diagramEngine, {
      width: root.clientWidth,
      fontFamily: getComputedStyle(root).fontFamily,
    });
    void (async () => {
      let n = 0;
      for (const code of diagrams) {
        if (cancelled) return;
        try {
          const { svg } = await draw(
            code.textContent ?? "",
            `split-mermaid-${Date.now()}-${n++}`,
          );
          if (cancelled) return;
          const box = document.createElement("div");
          box.className = "mermaid-preview";
          box.innerHTML = svg;
          code.parentElement?.replaceWith(box);
        } catch {
          // Incomplete diagram while typing: leave the source showing.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [html, filePath, diagramEngine]);

  // The scrollTop each side was last moved to by the other one. The scroll
  // event that move fires arrives a frame or more later (WebKitGTK, long
  // documents) - matching it by position, not by a one-frame guard, is what
  // keeps it from steering the side the user is actually scrolling back.
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
      <SourceTextarea
        ref={sourceRef}
        className="split-source"
        value={content}
        typewriter={typewriter}
        onChange={onChange}
        onScroll={(e) =>
          previewRef.current &&
          follow(e.currentTarget, previewRef.current, "source")
        }
      />
      <div
        ref={previewRef}
        className="split-preview"
        onScroll={(e) =>
          sourceRef.current &&
          follow(e.currentTarget, sourceRef.current, "preview")
        }
      >
        <div className="milkdown">
          {/* Keyed by the engine: the effect above replaces each fence
              with its picture, so a new engine needs the fences back. */}
          <div
            key={diagramEngine}
            id="write"
            className="ProseMirror split-preview-body"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </div>
  );
}
