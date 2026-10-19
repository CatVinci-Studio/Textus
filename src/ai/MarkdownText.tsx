import { useMemo } from "react";
import { renderMarkdownHtml } from "../editor/markdown/render-html";
import { useKatexReady } from "../editor/math/katex-loader";
// Replies render math with KaTeX; the detached chat window never loads the
// editor, so the stylesheet has to come with the renderer.
import "katex/dist/katex.min.css";

/**
 * Renders an assistant reply as formatted markdown (bold, lists, code,
 * links, ...) instead of a flat text blob. The model's raw output is
 * untrusted (it can be steered by document content or prompt injection), so
 * it's sanitized (renderMarkdownHtml) before going into the DOM via
 * `dangerouslySetInnerHTML`.
 */
export function MarkdownText({ text }: { text: string }) {
  // A reply's first formula loads KaTeX; render again once it is here.
  const katexReady = useKatexReady();
  const html = useMemo(
    () => renderMarkdownHtml(text),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, katexReady],
  );

  // Safe at this boundary because the generated HTML is sanitized above.
  return (
    <div
      className="agent-markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
