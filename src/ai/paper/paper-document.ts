import type { Outline } from "../../platform/bindings/ai-paper";

/** A section's text as it goes in the paper: the heading a kept section
 *  carries left off (the paper gives it one), and a code block, chart or
 *  figure mark still being written closed, so it doesn't take in the
 *  sections after it. */
export function sectionBody(text: string): string {
  let body = text.replace(/^##[^\n]*\n+/, "").trim();
  const comment = body.lastIndexOf("<!--");
  if (comment > body.lastIndexOf("-->")) body = body.slice(0, comment).trim();
  const fences = body.match(/^\s*```/gm)?.length ?? 0;
  if (fences % 2 === 1) body += "\n```";
  return body;
}

/** The paper as it stands while its sections are written: the topic as its
 *  title, then every section of the outline under its heading, with what
 *  its writer has written so far. */
export function paperDraft(
  topic: string,
  outline: Outline,
  sectionText: Record<number, string>,
): string {
  const parts = [`# ${topic}`];
  outline.sections.forEach((section, i) => {
    const body = sectionBody(sectionText[i] ?? "");
    parts.push(body ? `## ${section.title}\n\n${body}` : `## ${section.title}`);
  });
  return parts.join("\n\n");
}

const PICTURE_LINE =
  /^[ \t]*!\[[^\]\n]*\]\(textus-generated:[0-9a-z]+[^)\n]*\)[ \t]*\n?/gm;

/** The finished paper without its pictures: what is written first; the
 *  pictures follow once they are made. */
export function withoutPictures(markdown: string): string {
  return markdown.replace(PICTURE_LINE, "").replace(/\n{3,}/g, "\n\n");
}
