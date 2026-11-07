import type { Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { tags as t } from "@lezer/highlight";

/** Fallbacks keep the colours readable when only the base theme's variables
 *  are around (the playground loads content CSS without the editor theme). */
const v = (name: string, fallback: string) => `var(${name}, ${fallback})`;
const text = v("--doc-text", "#24272e");
const muted = v("--doc-muted", "#6b6b6b");
const accent = v("--doc-accent", "#315ed1");

/**
 * Colours for raw Markdown. Markup characters, headings, links, emphasis and
 * fenced code each get their own; the values come from the document theme so
 * source mode follows light/dark and imported themes with no second palette.
 */
export const sourceHighlightStyle = HighlightStyle.define([
  {
    tag: t.processingInstruction,
    color: v("--src-marker", muted),
  },
  { tag: t.contentSeparator, color: v("--src-marker", muted) },
  { tag: t.escape, color: v("--src-marker", accent) },
  { tag: t.meta, color: muted },
  { tag: t.punctuation, color: muted },
  { tag: t.bracket, color: muted },
  {
    tag: [
      t.heading,
      t.heading1,
      t.heading2,
      t.heading3,
      t.heading4,
      t.heading5,
      t.heading6,
    ],
    color: v("--src-heading", accent),
    fontWeight: "600",
  },
  {
    tag: t.strong,
    color: v("--src-strong", v("--doc-token-keyword", accent)),
    fontWeight: "600",
  },
  {
    tag: t.emphasis,
    color: v("--src-emphasis", v("--doc-token-function", accent)),
    fontStyle: "italic",
  },
  { tag: t.strikethrough, textDecoration: "line-through", opacity: "0.75" },
  { tag: t.quote, color: v("--src-quote", muted), fontStyle: "italic" },
  { tag: t.list, color: v("--src-list", v("--doc-token-function", accent)) },
  {
    tag: t.link,
    color: v("--src-link", v("--doc-token-string", accent)),
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  { tag: t.url, color: v("--src-url", v("--doc-token-number", accent)) },
  { tag: t.labelName, color: v("--src-url", v("--doc-token-number", accent)) },
  { tag: t.monospace, color: v("--src-code", v("--doc-token-tag", accent)) },
  { tag: t.comment, color: muted, fontStyle: "italic" },
  { tag: t.string, color: v("--doc-token-string", accent) },
  { tag: [t.number, t.bool, t.null], color: v("--doc-token-number", accent) },
  {
    tag: [t.keyword, t.operator, t.modifier],
    color: v("--doc-token-keyword", accent),
  },
  {
    tag: [
      t.function(t.variableName),
      t.definition(t.variableName),
      t.className,
      t.typeName,
    ],
    color: v("--doc-token-function", accent),
  },
  { tag: [t.tagName, t.attributeName], color: v("--doc-token-tag", accent) },
  { tag: t.content, color: text },
]);

/** The Markdown language (GFM tables, strikethrough and fenced code with
 *  their own language highlighting) plus the style above. */
export function sourceHighlighting(): Extension {
  return [
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(sourceHighlightStyle),
  ];
}
