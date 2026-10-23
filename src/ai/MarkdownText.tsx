import { useLayoutEffect, useMemo, useRef } from "react";
import { Cascade } from "../ui/cascade";
import {
  renderMarkdownHtml,
  renderMarkdownInlineHtml,
} from "../editor/markdown/render-html";
import { useKatexHtml } from "../editor/math/useKatexHtml";

/**
 * Renders an assistant reply as formatted markdown (bold, lists, code,
 * links, ...) instead of a flat text blob. The model's raw output is
 * untrusted (it can be steered by document content or prompt injection), so
 * it's sanitized (renderMarkdownHtml) before going into the DOM via
 * `dangerouslySetInnerHTML`. `live`: the reply is still streaming in,
 * its words coming in one by one as they arrive (ui/cascade.ts) - a reply
 * shown again from the conversation is simply there.
 */
export function MarkdownText({
  text,
  live = false,
}: {
  text: string;
  live?: boolean;
}) {
  // A reply's first formula loads KaTeX (and its stylesheet, which the
  // detached chat window, never loading the editor, needs too); the reply
  // renders again once it is here.
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
 * A review note's words (add_comment) with their inline Markdown - the
 * model writes a term in **bold** or `code`, which as plain text showed
 * its asterisks. Sanitized like a reply; line breaks kept by the card.
 */
export function InlineMarkdownText({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdownInlineHtml(text), [text]);
  // Safe: renderMarkdownInlineHtml sanitizes.
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
