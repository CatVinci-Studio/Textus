import { useLayoutEffect, useRef } from "react";
import { Cascade } from "../engine/controls/cascade";
import { noBlocks, showBlocks } from "./live-markdown";
import {
  renderMarkdownHtml,
  renderMarkdownInlineHtml,
} from "../editor/markdown/render-html";
import { useKatexHtml } from "../editor/math/useKatexHtml";

/** A streaming reply is drawn at most this often, however fast it comes. */
const LIVE_FRAME_MS = 100;

/**
 * Renders an assistant reply as markdown. The model's output is untrusted
 * (prompt injection), so it is sanitized before it is drawn.
 * `live`: the reply is still streaming, its words cascading in; it is drawn
 * block by block (live-markdown.ts), only its growing last block anew, at
 * most every LIVE_FRAME_MS, so a long reply streams without holding up the
 * window.
 */
export function MarkdownText({
  text,
  live = false,
}: {
  text: string;
  live?: boolean;
}) {
  // A reply's first formula loads KaTeX and its stylesheet (the detached chat
  // never loads the editor); the reply renders again once it is here. Not
  // while streaming: that is drawn block by block below.
  const html = useKatexHtml(live ? "" : text, renderMarkdownHtml);

  const root = useRef<HTMLDivElement>(null);
  const stream = useRef({
    cascade: null as Cascade | null,
    shown: noBlocks(),
    text,
    timer: 0,
  });
  stream.current.text = text;
  useLayoutEffect(() => {
    const s = stream.current;
    if (!live) {
      window.clearTimeout(s.timer);
      s.timer = 0;
      s.shown = noBlocks();
      return;
    }
    const draw = () => {
      s.timer = 0;
      if (!root.current) return;
      showBlocks(root.current, s.text, s.shown);
      (s.cascade ??= new Cascade()).play(root.current);
    };
    if (s.shown.sources.length === 0) draw();
    else if (!s.timer) s.timer = window.setTimeout(draw, LIVE_FRAME_MS);
  }, [text, live]);

  // Safe at this boundary because the generated HTML is sanitized above.
  return live ? (
    <div ref={root} className="agent-markdown" />
  ) : (
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
  // Drawn again once KaTeX arrives, as a reply is.
  const html = useKatexHtml(text, renderMarkdownInlineHtml);
  // Safe: renderMarkdownInlineHtml sanitizes.
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
