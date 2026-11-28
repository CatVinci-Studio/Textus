import { eachLine } from "../utils/markdown-lines";
// The Markdown handed to pandoc for export, rewritten where the editor's
// syntax has no pandoc equivalent: highlights, sized images, callouts,
// `[[links]]` and embeds, `~sub~`/`^sup^`, citations; `%%comments%%` go.
// Code and math are left as written, but for a display formula's lines
// set on as one paragraph (mathLine).

import { WIKILINK_SOURCE } from "../utils/note-link";
import { parseImageTag, splitAltSize } from "../editor/images/image-html";
import { splitImageTitle } from "../editor/images/image-rotation";
import { parseEmbed } from "../editor/images/obsidian-embed";
import { shownWikilink } from "../editor/markdown/wikilink-reveal";
import { linkDestination } from "../editor/markdown/link-syntax";
import {
  calloutHeading,
  readCalloutLine,
  type AlertType,
} from "../editor/markdown/callout-syntax";
import { OBJECT, findInlineSyntax } from "../editor/markdown/inline-syntax";
import type { NoteLinkOut } from "./note-links";
import { SUBSCRIPT_TEXT } from "../editor/marks/script-syntax";
import type { SingleTildeMode } from "../prefs/settings-values";
import {
  BACKTICK_MATH,
  DOLLAR_MATH,
  UNESCAPED,
} from "../editor/math/inline-math-rule";

const IMG_TAG = /<img\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
const IMAGE = /!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)/g;
const QUOTE = /^(?:[ \t]*>)+[ \t]?/;
// A block a comment can't run on into: a list item, heading or table row.
const BLOCK_START = /^\s*(?:[-+*]\s|\d{1,9}[.)]\s|#{1,6}\s|\|)/;

// Code and math, never rewritten but for GitHub's $`x`$, which Pandoc
// reads as $x$, and a dollar before code, which Pandoc could open math at.
const CODE_MATH = new RegExp(
  [
    "(`+)[\\s\\S]*?(?<!`)\\1(?!`)",
    UNESCAPED + BACKTICK_MATH,
    UNESCAPED + String.raw`\$\$[^$\n]+?\$\$`,
    UNESCAPED + DOLLAR_MATH,
    UNESCAPED + "\\$(?=`)",
  ].join("|"),
  "g",
);
const BACKTICK_MATH_SPAN = new RegExp(`^${BACKTICK_MATH}$`);
// Wikilinks and embeds (rewritten whole), a link's destination and URLs.
const LINKS = new RegExp(
  `!?${WIKILINK_SOURCE}|${String.raw`\]\([^)\s]*|<[a-z][a-z0-9+.-]*:[^>\s]*>|\bhttps?:\/\/[^\s<>)]+`}`,
  "gi",
);

// One pass over the words, so nothing a rewrite writes is read again.
// Groups: 1 citation, 2 highlight, 3 superscript (as script-syntax reads
// one), 4 tilde span, 5 an emoji name after its opening colon.
const INLINE =
  /(\[(?:[^[\]\n]*?[\s;])?-?@[\p{L}\p{N}_][^[\]\n]*\](?![([:]))|==(?=\S)(.+?)(?<=\S)==|(?<![\^[\\])\^(?![[^])((?:[+-]?[A-Za-z0-9]+[+-]?|[+-]+)(?=\^)|[^\s^]+(?=\^(?![A-Za-z0-9])))\^|(?<![~\\])~([^~\s](?:[^~\n]*[^~\s])?)~(?!~)|(?<!\\):(?=([a-z0-9_+-]+):)/gu;

const WORD = /[\p{L}\p{N}]/u;

/** `text` with `outside` applied between the matches of `spans`, and
 *  `inside` (by default, nothing) to each match and the character after. */
function between(
  text: string,
  spans: RegExp,
  outside: (text: string) => string,
  inside: (span: string, next: string) => string = (span) => span,
): string {
  let out = "";
  let at = 0;
  for (const m of text.matchAll(spans)) {
    const end = m.index + m[0].length;
    out += outside(text.slice(at, m.index)) + inside(m[0], text[end] ?? "");
    at = end;
  }
  return out + outside(text.slice(at));
}

type AlertLabels = Record<AlertType, string>;

interface PandocRewrite {
  /** The editor's labels for GitHub's alerts; without them a callout stays. */
  alertLabels?: AlertLabels;
  /** Where each `[[link]]` and `![[embed]]` leads; any other is its text. */
  noteLinks?: ReadonlyMap<string, NoteLinkOut | null>;
  /** A bibliography is set: `[@key]` goes to Pandoc's citeproc. */
  citations?: boolean;
  /** What `~text~` reads as in the editor; subscript by default. */
  singleTilde?: SingleTildeMode;
}

/** Every ASCII punctuation mark escaped: the text reads as written. */
const literal = (text: string) => text.replace(/[!-/:-@[-`{-~]/g, "\\$&");
const bracketsEscaped = (text: string) => text.replace(/([[\]])/g, "\\$1");
const destination = (path: string) => `<${path.replace(/[<>]/g, encodeURI)}>`;

/** An `<img>` tag as a pandoc image, or the tag itself when no image node
 *  carries it. */
function imageTag(tag: string): string {
  const image = parseImageTag(tag);
  if (!image) return tag;
  const alt = image.alt.replace(/([[\]\\])/g, "\\$1");
  const src = linkDestination(image.src);
  const title = image.title
    ? ` "${image.title.replace(/(["\\])/g, "\\$1")}"`
    : "";
  const width = /^\d+$/.test(image.width) ? `${image.width}px` : image.width;
  return `![${alt}](${src}${title})${width ? `{width=${width}}` : ""}`;
}

/** A Markdown image with Textus's size or turn in its title, or
 *  Obsidian's size in its alt, as pandoc writes a width; any other as is. */
function sizedImage(
  whole: string,
  alt: string,
  src: string,
  title: string | undefined,
): string {
  const kept = splitImageTitle(title);
  const sized = splitAltSize(alt);
  if (kept.title === (title ?? "") && !sized.width) return whole;
  const width =
    kept.widthPercent !== null
      ? `${kept.widthPercent}%`
      : sized.width && `${sized.width}px`;
  const shown = kept.title.trim() ? ` "${kept.title.trim()}"` : "";
  return `![${sized.alt}](${src}${shown})${width ? `{width=${width}}` : ""}`;
}

function noteLink(source: string, options: PandocRewrite): string {
  const out = options.noteLinks?.get(source) ?? null;
  const embed = parseEmbed(source);
  if (out && "image" in out) {
    const width = embed?.width ? `{width=${embed.width}px}` : "";
    return `![${literal(out.alt)}](${destination(out.image)})${width}`;
  }
  const text = embed ? embed.alt || embed.path : shownWikilink(source);
  return out ? `[${literal(text)}](${destination(out.href)})` : literal(text);
}

function rewriteText(text: string, options: PandocRewrite): string {
  return text.replace(
    INLINE,
    (whole, cite, mark, sup, tilde, emoji, offset: number) => {
      // Pandoc reads any :name: as an emoji; the editor only one not glued
      // to a letter or digit (emoji-shortcode-plugin).
      if (emoji !== undefined) {
        const end = offset + emoji.length + 2;
        return WORD.test(text[offset - 1] ?? "") || WORD.test(text[end] ?? "")
          ? "\\:"
          : whole;
      }
      if (cite) return options.citations ? `\`${cite}\`{=textuscite}` : whole;
      if (mark) return `[${rewriteText(mark, options)}]{.mark}`;
      if (sup) return `[${bracketsEscaped(sup)}]{.textus-sup}`;
      // As the editor reads it (editor-core-syntax): a subscript after a
      // letter or digit, then a strikethrough or the tildes as written,
      // which pandoc, reading `~x~` as a subscript, gets escaped.
      const mode = options.singleTilde ?? "subscript";
      const afterWord = WORD.test(text[offset - 1] ?? "");
      const subscript =
        mode === "strikethrough"
          ? afterWord && !/\s/.test(tilde)
          : mode === "subscript" && afterWord && SUBSCRIPT_TEXT.test(tilde);
      if (subscript) return `[${bracketsEscaped(tilde)}]{.textus-sub}`;
      return mode === "strikethrough" ? `~~${tilde}~~` : `\\~${tilde}\\~`;
    },
  );
}

/** A math span as Pandoc reads it: GitHub's $`x`$ as $x$ (no space just
 *  inside, a dollar in it escaped, an empty raw span before a digit so it
 *  still closes); a dollar before code, which opens nothing, escaped. */
function dollarMath(span: string, next: string): string {
  if (span === "$") return "\\$";
  const found = BACKTICK_MATH_SPAN.exec(span);
  if (!found) return span;
  const formula = found[1].trim();
  // A blank formula draws nothing; one ending in a lone backslash can't
  // close in Pandoc's form, so it reads as written.
  if (!formula) return "";
  if (/(?:^|[^\\])(?:\\\\)*\\$/.test(formula)) return literal(span);
  const digit = /\d/.test(next) ? "` `{=textus}" : "";
  return `$${formula.replace(/(?<!\\)\$/g, "\\$")}$${digit}`;
}

/** Rewrites prose: what code, math and URLs hold is left as written. */
function rewriteProse(line: string, options: PandocRewrite): string {
  return between(
    line,
    CODE_MATH,
    (prose) =>
      between(
        prose.replace(IMG_TAG, imageTag).replace(IMAGE, sizedImage),
        LINKS,
        (words) => rewriteText(words, options),
        (span) => (span.endsWith("]]") ? noteLink(span, options) : span),
      ),
    dollarMath,
  );
}

/** `text` without its `%%comments%%`, found as the editor finds them in
 *  one paragraph; a line that was all comment goes with it. */
function withoutComments(text: string): string {
  const mask = (span: string) => OBJECT.repeat(span.length);
  const masked = between(
    text,
    CODE_MATH,
    (prose) => between(prose, LINKS, (words) => words, mask),
    mask,
  );
  const comments = findInlineSyntax(masked).filter((s) => s.kind === "comment");
  if (!comments.length) return text;
  let out = "";
  let at = 0;
  for (const comment of comments) {
    let { from, to } = comment;
    const start = text.lastIndexOf("\n", from - 1) + 1;
    const end =
      text.indexOf("\n", to) < 0 ? text.length : text.indexOf("\n", to);
    const lead = text.slice(start, from).replace(QUOTE, "");
    if (!lead.trim() && !text.slice(to, end).trim()) {
      from = start > 0 ? start - 1 : start;
      to = start > 0 || end === text.length ? end : end + 1;
    }
    out += text.slice(at, Math.max(at, from));
    at = to;
  }
  return out + text.slice(at);
}

const quoteDepth = (line: string) =>
  (QUOTE.exec(line)?.[0].match(/>/g) ?? []).length;

/** A callout's first line as a bold heading of its own, with the editor's
 *  label; only where a quote starts, as the editor reads it. */
function callout(
  line: string,
  previous: string,
  options: PandocRewrite,
): string | null {
  const labels = options.alertLabels;
  const prefix = QUOTE.exec(line)?.[0];
  if (!labels || !prefix || quoteDepth(previous) >= quoteDepth(line))
    return null;
  const found = readCalloutLine(line.slice(prefix.length));
  if (!found) return null;
  const heading = calloutHeading(found, (type) => labels[type]);
  return `${prefix}**${rewriteProse(heading, options)}**\n${prefix.trimEnd()}`;
}

/**
 * A line inside a `$$` formula, indented four spaces past its quote marks
 * and indent. Pandoc reads `$$` maths inside a paragraph, so a formula's
 * lone `=` or `-` line made the line above a setext heading, and a `#` or
 * `- ` line a heading or list, splitting the formula. Indented so, every
 * line goes on the paragraph; maths ignores the spaces (#851).
 */
function mathLine(line: string): string {
  return line.replace(/^((?:[ \t]*>)*[ \t]*)/, "$1    ");
}

/** Splits `markdown` into runs of code lines and runs of prose paragraphs. */
function blocks(markdown: string): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = [];
  const push = (code: boolean, line: string, joins: boolean) => {
    const last = out.at(-1);
    if (last && last.code === code && joins) last.text += `\n${line}`;
    else out.push({ code, text: line });
  };
  let previousMath = false;
  eachLine(
    markdown,
    (line, _index, code, math = false) => {
      const opened = previousMath;
      previousMath = math;
      if (code) {
        push(true, math && opened ? mathLine(line) : line, true);
      } else {
        const joins =
          !!line.trim() &&
          !!out.at(-1)?.text.split("\n").at(-1)?.trim() &&
          !BLOCK_START.test(line) &&
          quoteDepth(line) === quoteDepth(out.at(-1)!.text.split("\n").at(-1)!);
        push(false, line, joins);
      }
    },
    { math: true, frontMatter: true },
  );
  return out;
}

export function toPandocMarkdown(
  markdown: string,
  options: PandocRewrite = {},
): string {
  return blocks(markdown)
    .map(({ code, text }) => {
      if (code) return text;
      const lines = withoutComments(text).split("\n");
      return lines
        .map(
          (line, i) =>
            callout(line, lines[i - 1] ?? "", options) ??
            rewriteProse(line, options),
        )
        .join("\n");
    })
    .join("\n");
}
