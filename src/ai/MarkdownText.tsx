import { memo, useMemo } from "react";
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
 *
 * Memoized, with a stable `__html` object: React 19 compares that object by
 * identity, so a fresh one on each parent render rewrote the element's
 * innerHTML every time - every message and the whole document preview were
 * rebuilt on each streamed token, images reloaded, and anything done to the
 * nodes afterwards (resolved image paths) was lost.
 */
export const MarkdownText = memo(function MarkdownText({
  text,
  imageSrc,
}: {
  text: string;
  /** Where each image's `src` really points (a document's pictures by
   *  their paths); applied after sanitizing. Keep it stable. */
  imageSrc?: (src: string) => string;
}) {
  // A reply's first formula loads KaTeX; render again once it is here.
  const katexReady = useKatexReady();
  const inner = useMemo(
    () => ({ __html: withImageSrc(renderMarkdownHtml(text), imageSrc) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, katexReady, imageSrc],
  );

  // Safe at this boundary because the generated HTML is sanitized above.
  return <div className="agent-markdown" dangerouslySetInnerHTML={inner} />;
});

/** Sanitized HTML with each image's `src` mapped (kept as data-doc-src). */
export function withImageSrc(
  html: string,
  imageSrc?: (src: string) => string,
): string {
  if (!imageSrc || !html.includes("<img")) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const img of template.content.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (!src || img.hasAttribute("data-draft-picture")) continue;
    img.setAttribute("data-doc-src", src);
    img.setAttribute("src", imageSrc(src));
  }
  return template.innerHTML;
}
