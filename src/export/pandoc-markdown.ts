// The Markdown handed to pandoc for File > Export (Word, OpenDocument, ...),
// rewritten where the editor's own syntax has no pandoc equivalent. Pandoc
// reads it as commonmark_x (commands/export.rs), which gives bracketed spans
// and attributes; code (fenced blocks and inline spans) is left untouched.
//
// - `==text==` (highlight) becomes `[text]{.mark}`, which Word shows as a
//   highlight; left alone it would print with its equals signs.
// - An image's width, kept in its title as `{textus-width=N%}`
//   (image-plugin.ts), becomes `{width=N%}`, so the picture keeps its size
//   instead of filling the page with the marker as its title.
// - A GitHub alert (`> [!NOTE]`) becomes a quote led by its label in bold,
//   in the words the editor shows (备注, Hinweis...); pandoc would title it
//   "Note" in English whatever the document's language.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// The title's presentation suffix: a width and/or a rotation (which pandoc
// has no attribute for, so it is dropped rather than printed as the title).
const IMAGE_WIDTH =
  /!\[([^\]]*)\]\((\S+?)\s+"([^"]*?)\s*\{(?:\s*(?:textus|levis)-(?:width=(\d{1,3})%|rotate=\d{1,3}))+\s*\}"\)/g;
const HIGHLIGHT = /==(?=\S)(.+?)(?<=\S)==/g;
const ALERT = /^(\s*>\s*)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/;

export type AlertLabels = Record<
  "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION",
  string
>;

function rewriteProse(text: string): string {
  return text
    .replace(IMAGE_WIDTH, (match, alt: string, src: string, title: string) => {
      const kept = title.trim() ? ` "${title.trim()}"` : "";
      const w = /-width=(\d{1,3})%/.exec(match)?.[1];
      return `![${alt}](${src}${kept})${w ? `{width=${w}%}` : ""}`;
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
