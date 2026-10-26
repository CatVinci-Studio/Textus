import { useLayoutEffect, useMemo, useRef } from "react";
import { Cascade } from "../ui/cascade";
import {
  renderMarkdownHtml,
  renderMarkdownInlineHtml,
} from "../editor/markdown/render-html";
import { useKatexHtml } from "../editor/math/useKatexHtml";

/**
 * Renders an assistant reply as markdown. The model's output is untrusted
 * (prompt injection), so it is sanitized before `dangerouslySetInnerHTML`.
 * `live`: the reply is still streaming, its words cascading in.
 */
export function MarkdownText({
  text,
  live = false,
}: {
  text: string;
  live?: boolean;
}) {
  // A reply's first formula loads KaTeX and its stylesheet (the detached chat
  // never loads the editor); the reply renders again once it is here.
  const html = useKatexHtml(text, renderMarkdownHtml);

  const root = useRef<HTMLDivElement>(null);
  const cascade = useRef<Cascade | null>(null);
  useLayoutEffect(() => {
    if (!live || !root.current) return;
    (cascade.current ??= new Cascade()).play(root.current);
  }, [html, live]);

  // Safe at this boundary because the generated HTML is sanitized above.
  return (
    <div
      ref={root}
      className="agent-markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * A review note's words with their inline Markdown, sanitized like a reply;
 * the card keeps line breaks.
 */
export function InlineMarkdownText({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdownInlineHtml(text), [text]);
  // Safe: renderMarkdownInlineHtml sanitizes.
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
