import { Marked, type TokenizerAndRendererExtension } from "marked";
import { katexNow, mathSourceHtml } from "../math/katex-loader";
import DOMPurify from "dompurify";
import { normalizeMathDelimiters } from "../../utils/markdown-math";

function renderMath(source: string, displayMode: boolean): string {
  const katex = katexNow();
  // Its first formula: the source for a moment, re-rendered once KaTeX
  // loads (MarkdownText's useKatexReady).
  if (!katex) return mathSourceHtml(source.trim());
  return katex.renderToString(source.trim(), {
    displayMode,
    // A half-typed or invalid formula renders as its source in red rather
    // than throwing away the whole reply.
    throwOnError: false,
    output: "htmlAndMathml",
  });
}

// `$$...$$` on its own lines, and `$...$` inside text - the same two forms
// the editor's math schema (remark-math) reads, so a formula looks the same
// in a reply as it will once accepted into the document. Inline `$` needs a
// non-space just inside each delimiter and no digit right after the closing
// one, so prices like "$5 and $10" stay text.
const mathBlock: TokenizerAndRendererExtension = {
  name: "mathBlock",
  level: "block",
  start: (src) => src.indexOf("$$"),
  tokenizer(src) {
    const match = /^\$\$([\s\S]+?)\$\$[^\S\n]*(?:\n+|$)/.exec(src);
    if (match) return { type: "mathBlock", raw: match[0], text: match[1] };
    return undefined;
  },
  renderer: (token) =>
    `<div class="agent-math">${renderMath(token.text, true)}</div>`,
};

const mathInline: TokenizerAndRendererExtension = {
  name: "mathInline",
  level: "inline",
  start: (src) => src.indexOf("$"),
  tokenizer(src) {
    const display = /^\$\$([^$]+?)\$\$/.exec(src);
    if (display)
      return {
        type: "mathInline",
        raw: display[0],
        text: display[1],
        display: true,
      };
    const match = /^\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/.exec(src);
    if (match)
      return {
        type: "mathInline",
        raw: match[0],
        text: match[1],
        display: false,
      };
    return undefined;
  },
  renderer: (token) => renderMath(token.text, Boolean(token.display)),
};

// Its own instance, not the global `marked`: these options and extensions
// are for short-form conversational content only. A bare newline breaks the
// line like it visually looks, rather than needing a blank line the way
// document-editing markdown does.
const chatMarked = new Marked({
  gfm: true,
  breaks: true,
  extensions: [mathBlock, mathInline],
});

/**
 * Markdown source -> sanitized HTML, block-aware (paragraphs, lists,
 * headings, tables and display math all become their own elements). For
 * content that renders into a genuine block-level container - the chat
 * reply (MarkdownText.tsx).
 */
export function renderMarkdownHtml(markdown: string): string {
  // `\(`/`\[` are folded to `$`/`$$` first, so either delimiter style
  // renders (and markdown's backslash escaping can't mangle them).
  const parsed = chatMarked.parse(normalizeMathDelimiters(markdown), {
    async: false,
  });
  return DOMPurify.sanitize(parsed);
}

// The document flavour: markdown as the editor reads it - a single newline
// is not a line break - for the split view's preview (editor/modes/SplitView.tsx).
const documentMarked = new Marked({
  gfm: true,
  breaks: false,
  extensions: [mathBlock, mathInline],
  // `[](https://...)` shows its URL, as it does in the editor
  // (markdown-output.ts) - rendered empty, the link was there but invisible.
  walkTokens: (token) => {
    if (token.type === "link" && token.tokens?.length === 0)
      token.tokens = [
        { type: "text", raw: token.href, text: token.href, escaped: false },
      ];
  },
});

/** A whole document -> sanitized HTML, for the split view's preview. YAML
 *  front matter is dropped (the editor shows it as a block, not prose). */
export function renderDocumentHtml(markdown: string): string {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const parsed = documentMarked.parse(normalizeMathDelimiters(body), {
    async: false,
  });
  return DOMPurify.sanitize(parsed);
}

/**
 * Markdown source -> sanitized HTML, INLINE only (no wrapping `<p>`/`<ul>`/
 * heading elements - bold/italic/code/links/math stay inline, paragraph
 * breaks fold to line breaks via `breaks: true`). For content that renders
 * inside an inline decoration widget (pending-edit-plugin.ts's green insert
 * widget), where a real block element would be invalid HTML nested inside
 * the surrounding paragraph's inline content.
 */
export function renderMarkdownInlineHtml(markdown: string): string {
  const parsed = chatMarked.parseInline(normalizeMathDelimiters(markdown), {
    async: false,
  });
  return DOMPurify.sanitize(parsed);
}
