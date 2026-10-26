// The Markdown handed to pandoc for export, rewritten where the editor's
// syntax has no pandoc equivalent: highlights, sized images and GitHub
// alerts with localized labels. Code is left untouched.

import { parseImageTag } from "../editor/images/image-html";

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const IMG_TAG = /<img\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
const IMAGE_WIDTH =
  /!\[([^\]]*)\]\((\S+?)\s+"([^"]*?)\s*\{textus-width=(\d{1,3})%\}"\)/g;
const HIGHLIGHT = /==(?=\S)(.+?)(?<=\S)==/g;
const ALERT = /^(\s*>\s*)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/;

export type AlertLabels = Record<
  "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION",
  string
>;

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

function rewriteProse(text: string): string {
  return text
    .replace(IMG_TAG, imageTag)
    .replace(IMAGE_WIDTH, (_m, alt: string, src: string, title: string, w) => {
      const kept = title.trim() ? ` "${title.trim()}"` : "";
      return `![${alt}](${src}${kept}){width=${w}%}`;
    })
    .replace(HIGHLIGHT, "[$1]{.mark}");
}

/** Rewrites one line outside code blocks, skipping its inline code spans. */
function rewriteLine(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const tick = line.indexOf("`", i);
    if (tick < 0) {
      out += rewriteProse(line.slice(i));
      break;
    }
    out += rewriteProse(line.slice(i, tick));
    const run = /^`+/.exec(line.slice(tick))![0];
    const close = line.indexOf(run, tick + run.length);
    if (close < 0) {
      out += line.slice(tick);
      break;
    }
    out += line.slice(tick, close + run.length);
    i = close + run.length;
  }
  return out;
}

export function toPandocMarkdown(
  markdown: string,
  alertLabels?: AlertLabels,
): string {
  let fence: string | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      const match = FENCE.exec(line);
      if (fence) {
        if (
          match &&
          match[1][0] === fence[0] &&
          match[1].length >= fence.length
        )
          fence = null;
        return line;
      }
      if (match) {
        fence = match[1];
        return line;
      }
      const alert = alertLabels && ALERT.exec(line);
      if (alert)
        return `${alert[1]}**${alertLabels[alert[2] as keyof AlertLabels]}**`;
      return rewriteLine(line);
    })
    .join("\n");
}
