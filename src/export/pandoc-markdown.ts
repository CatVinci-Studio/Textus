import { eachLine } from "../utils/markdown-lines";
// The Markdown handed to pandoc for export, rewritten where the editor's
// syntax has no pandoc equivalent: highlights, sized images, callouts,
// `[[links]]` and embeds, `~sub~`/`^sup^`, citations; `%%comments%%` go.
// Code and math are left untouched.

import { WIKILINK_SOURCE } from "../utils/note-link";
import { parseImageTag, splitAltSize } from "../editor/images/image-html";
import { splitImageTitle } from "../editor/images/image-rotation";
import { parseEmbed } from "../editor/images/obsidian-embed";
import { shownWikilink } from "../editor/markdown/wikilink-reveal";
import {
  calloutHeading,
  readCalloutLine,
  type AlertType,
} from "../editor/markdown/callout-syntax";
import { OBJECT, findInlineSyntax } from "../editor/markdown/inline-syntax";
import type { NoteLinkOut } from "./note-links";

const IMG_TAG = /<img\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
const IMAGE = /!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)/g;
const QUOTE = /^(?:[ \t]*>)+[ \t]?/;
// A block a comment can't run on into: a list item, heading or table row.
const BLOCK_START = /^\s*(?:[-+*]\s|\d{1,9}[.)]\s|#{1,6}\s|\|)/;

// Code and math, never rewritten.
const CODE_MATH =
  /(`+)[\s\S]*?(?<!`)\1(?!`)|(?<!\\)\$\$[^$\n]+?\$\$|(?<!\\)\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d)/g;
// Wikilinks and embeds (rewritten whole), a link's destination and URLs.
const LINKS = new RegExp(
  `!?${WIKILINK_SOURCE}|${String.raw`\]\([^)\s]*|<[a-z][a-z0-9+.-]*:[^>\s]*>|\bhttps?:\/\/[^\s<>)]+`}`,
  "gi",
);

// One pass over the words, so nothing a rewrite writes is read again.
// Groups: 1 citation, 2 highlight, 3 superscript, 4 tilde span.
const INLINE =
  /(\[(?:[^[\]\n]*?[\s;])?-?@[\p{L}\p{N}_][^[\]\n]*\](?![([:]))|==(?=\S)(.+?)(?<=\S)==|(?<![\^[\\])\^(?![[^])([^\s^]+)\^|(?<![~\\])~([^~\s](?:[^~\n]*[^~\s])?)~(?!~)/gu;

/** `text` with `outside` applied between the matches of `spans`, and
 *  `inside` (by default, nothing) to each match. */
function between(
  text: string,
  spans: RegExp,
  outside: (text: string) => string,
  inside: (span: string) => string = (span) => span,
): string {
  let out = "";
  let at = 0;
  for (const m of text.matchAll(spans)) {
    out += outside(text.slice(at, m.index)) + inside(m[0]);
    at = m.index + m[0].length;
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
  const src = /[\s()<>]/.test(image.src) ? `<${image.src}>` : image.src;
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
    (whole, cite, mark, sup, tilde, offset: number) => {
      if (cite) return options.citations ? `\`${cite}\`{=textuscite}` : whole;
      if (mark) return `[${rewriteText(mark, options)}]{.mark}`;
      if (sup) return `[${bracketsEscaped(sup)}]{.textus-sup}`;
      // The editor's rule: one tilde after a letter or digit, around text
      // with no space, is a subscript; anywhere else it strikes through.
      const subscript =
        /[\p{L}\p{N}]/u.test(text[offset - 1] ?? "") && !/\s/.test(tilde);
      return subscript
        ? `[${bracketsEscaped(tilde)}]{.textus-sub}`
        : `~~${tilde}~~`;
    },
  );
}

/** Rewrites prose: what code, math and URLs hold is left as written. */
function rewriteProse(line: string, options: PandocRewrite): string {
  return between(line, CODE_MATH, (prose) =>
    between(
      prose.replace(IMG_TAG, imageTag).replace(IMAGE, sizedImage),
      LINKS,
      (words) => rewriteText(words, options),
      (span) => (span.endsWith("]]") ? noteLink(span, options) : span),
    ),
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

/** Splits `markdown` into runs of code lines and runs of prose paragraphs. */
function blocks(markdown: string): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = [];
  const push = (code: boolean, line: string, joins: boolean) => {
    const last = out.at(-1);
    if (last && last.code === code && joins) last.text += `\n${line}`;
    else out.push({ code, text: line });
  };
  eachLine(
    markdown,
    (line, _index, code) => {
      if (code) {
        push(true, line, true);
      } else {
        const joins =
          !!line.trim() &&
          !!out.at(-1)?.text.split("\n").at(-1)?.trim() &&
          !BLOCK_START.test(line) &&
          quoteDepth(line) === quoteDepth(out.at(-1)!.text.split("\n").at(-1)!);
        push(false, line, joins);
      }
    },
    { math: true },
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
