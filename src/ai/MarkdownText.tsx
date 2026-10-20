import { useMemo } from "react";
import { renderMarkdownHtml } from "../editor/markdown/render-html";
import { useKatexReady } from "../editor/math/katex-loader";

/**
 * Renders an assistant reply as formatted markdown (bold, lists, code,
 * links, ...) instead of a flat text blob. The model's raw output is
 * untrusted (it can be steered by document content or prompt injection), so
 * it's sanitized (renderMarkdownHtml) before going into the DOM via
 * `dangerouslySetInnerHTML`.
 */
export function MarkdownText({ text }: { text: string }) {
  // A reply's first formula loads KaTeX (and its stylesheet, which the
  // detached chat window, never loading the editor, needs too); the reply
  // renders again once it is here.
  const katexReady = useKatexReady();
  const html = useMemo(
    () => renderMarkdownHtml(text),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a render key
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
