import { Marked, Renderer, type TokenizerAndRendererExtension } from "marked";
import DOMPurify from "dompurify";
import { escapeHtml } from "../../utils/html";
import { normalizeMathDelimiters } from "../../utils/markdown-math";
import { sanitizeNodes } from "../html/html-policy";
import { readImagePresentation } from "../images/image-html";
import { katexNow, mathSourceHtml } from "../math/katex-loader";
import { renderFormula } from "../math/matrix-rows";

function renderMath(source: string, displayMode: boolean): string {
  const katex = katexNow();
  // Before KaTeX has loaded, the source; callers redraw once it is here.
  if (!katex) return mathSourceHtml(source.trim());
  return renderFormula(katex, source.trim(), {
    displayMode,
    // A half-typed formula renders as its source in red rather than throwing
    // away the whole reply.
    throwOnError: false,
    output: "htmlAndMathml",
  });
}

/** One formula as HTML: a display block in its own container, or inline. */
function mathHtml(source: string, display: boolean, block: boolean): string {
  const html = renderMath(source, display);
  return block ? `<div class="agent-math">${html}</div>` : html;
}

// `$$...$$` on its own lines and `$...$` inside text, as the editor's math
// schema reads them. Inline `$` needs a non-space just inside each delimiter
// and no digit after the closing one, so "$5 and $10" stays text.
function mathExtensions(
  render: (source: string, display: boolean, block: boolean) => string,
): TokenizerAndRendererExtension[] {
  const mathBlock: TokenizerAndRendererExtension = {
    name: "mathBlock",
    level: "block",
    start: (src) => src.indexOf("$$"),
    tokenizer(src) {
      const match = /^\$\$([\s\S]+?)\$\$[^\S\n]*(?:\n+|$)/.exec(src);
      if (match) return { type: "mathBlock", raw: match[0], text: match[1] };
      return undefined;
    },
    renderer: (token) => render(token.text, true, true),
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
    renderer: (token) => render(token.text, Boolean(token.display), false),
  };
  return [mathBlock, mathInline];
}

// An Obsidian wikilink, drawn as the editor draws it, in the link colour.
const wikilink: TokenizerAndRendererExtension = {
  name: "wikilink",
  level: "inline",
  start: (src) => src.indexOf("[["),
  tokenizer(src) {
    const match = /^\[\[[^[\]\n]+\]\]/.exec(src);
    if (match) return { type: "wikilink", raw: match[0] };
    return undefined;
  },
  renderer: (token) => `<span class="wikilink">${escapeHtml(token.raw)}</span>`,
};

// Its own instance, not the global `marked`: for chat replies, where a bare
// newline breaks the line.
const chatMarked = new Marked({
  gfm: true,
  breaks: true,
  extensions: [...mathExtensions(mathHtml), wikilink],
});

/** Markdown source -> sanitized, block-aware HTML, for the chat reply. */
export function renderMarkdownHtml(markdown: string): string {
  // `\(`/`\[` are folded to `$`/`$$` first, so markdown's backslash escaping
  // can't mangle them.
  const parsed = chatMarked.parse(normalizeMathDelimiters(markdown), {
    async: false,
  });
  return DOMPurify.sanitize(parsed);
}

// Footnotes, which marked has no syntax for: a reference `[^2]` as its
// raised label, and a definition `[^2]: …` as a paragraph opening with it.
const footnotes: TokenizerAndRendererExtension[] = [
  {
    name: "footnoteDefinition",
    level: "block",
    start: (src) => src.match(/^\[\^[^\]\s]+\]:/m)?.index,
    tokenizer(src) {
      const match =
        /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?: {2,}|\t)[^\n]*)*)(?:\n+|$)/.exec(
          src,
        );
      if (!match) return undefined;
      const token = {
        type: "footnoteDefinition",
        raw: match[0],
        label: match[1],
        text: match[2].replace(/\n(?: {2,}|\t)/g, " "),
        tokens: [],
      };
      this.lexer.inline(token.text, token.tokens);
      return token;
    },
    renderer(token) {
      const label = escapeHtml(String(token.label));
      return `<p><sup>${label}</sup> ${this.parser.parseInline(token.tokens ?? [])}</p>\n`;
    },
  },
  {
    name: "footnoteReference",
    level: "inline",
    start: (src) => src.indexOf("[^"),
    tokenizer(src) {
      const match = /^\[\^([^\]\s]+)\](?!:)/.exec(src);
      if (!match) return undefined;
      return { type: "footnoteReference", raw: match[0], label: match[1] };
    },
    renderer: (token) => `<sup>${escapeHtml(String(token.label))}</sup>`,
  },
];

// The inline flavour: the chat's, plus footnote references raised.
const inlineMarked = new Marked({
  gfm: true,
  breaks: true,
  extensions: [
    ...mathExtensions(mathHtml),
    ...footnotes.filter((f) => f.name === "footnoteReference"),
  ],
});

// The document's formulas, in order: a placeholder element stands for each,
// so the HTML policy (which would strip KaTeX's classes) never sees them.
let mathSlots: string[] = [];
const MATH_SLOT_TAG = "textus-math";

// The document flavour, for the split view: a single newline is not a line
// break.
const documentMarked = new Marked({
  gfm: true,
  breaks: false,
  extensions: [
    ...mathExtensions((source, display, block) => {
      mathSlots.push(DOMPurify.sanitize(mathHtml(source, display, block)));
      return `<${MATH_SLOT_TAG} data-slot="${mathSlots.length - 1}"></${MATH_SLOT_TAG}>`;
    }),
    ...footnotes,
  ],
  renderer: {
    // A width an older Textus kept in the title sizes the picture, as in the
    // editor.
    image(token) {
      const { title, widthPercent } = readImagePresentation(token.title);
      if (widthPercent === null) return false;
      const html = Renderer.prototype.image.call(this, {
        ...token,
        title: title || null,
      });
      return html.replace(/^<img /, `<img width="${widthPercent}%" `);
    },
  },
  // `[](https://...)` shows its URL, as in the editor, instead of nothing.
  walkTokens: (token) => {
    if (token.type === "link" && token.tokens?.length === 0)
      token.tokens = [
        { type: "text", raw: token.href, text: token.href, escaped: false },
      ];
  },
});

/** A whole document -> sanitized HTML, for the split view's preview. Front
 *  matter is dropped; raw HTML follows the editor's policy. */
export function renderDocumentHtml(markdown: string): string {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
  mathSlots = [];
  const parsed = documentMarked.parse(normalizeMathDelimiters(body), {
    async: false,
  });
  const slots = mathSlots;
  mathSlots = [];
  const doc = new DOMParser().parseFromString(parsed, "text/html");
  const out = doc.createElement("div");
  sanitizeNodes(Array.from(doc.body.childNodes), out, {
    // KaTeX's output, already through DOMPurify. A placeholder typed by hand can
    // only repeat one of the document's own formulas.
    replace: (el) => {
      if (el.localName !== MATH_SLOT_TAG) return undefined;
      const html = slots[Number(el.getAttribute("data-slot"))];
      const template = doc.createElement("template");
      template.innerHTML = html ?? "";
      return template.content;
    },
  });
  return out.innerHTML;
}

/**
 * Markdown source -> sanitized inline-only HTML, for an inline decoration
 * widget where a block element would be invalid inside the paragraph.
 */
export function renderMarkdownInlineHtml(markdown: string): string {
  const parsed = inlineMarked.parseInline(normalizeMathDelimiters(markdown), {
    async: false,
  });
  return DOMPurify.sanitize(parsed);
}
