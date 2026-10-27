import { useDeferredValue, useEffect, useRef } from "react";
import { renderDocumentHtml } from "../markdown/render-html";
import { useKatexHtml } from "../math/useKatexHtml";
import { resolveImageSrc } from "../images/image-plugin";
import { diagramRenderer } from "../diagram-engine";
import { useSettings } from "../../settings/SettingsContext";
import { SourceTextarea } from "./SourceTextarea";
import "./SplitView.css";

/**
 * Split view: editable markdown source on the left, the rendered document
 * on the right, styled by the same theme. Scrolling follows by proportion;
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
  const html = useKatexHtml(deferred, renderDocumentHtml);
  const { diagramEngine } = useSettings().settings;

  // Relative image paths resolve against the document's folder; Mermaid
  // fences become diagrams.
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
    // The editor's own engines and settings: mermaid is one global, so other
    // settings here would reset the editor's diagrams too.
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
      <SourceTextarea
        ref={sourceRef}
        className="split-source"
        value={content}
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
