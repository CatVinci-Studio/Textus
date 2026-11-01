import {
  firstContentLine,
  firstLevelOneHeading,
  markdownFilename,
} from "../document/save-default-name";

/** The start of a document is enough to name it, and keeps the request
 *  small; Rust (ai/doc_title.rs) cuts anything longer too. */
export const TITLE_EXCERPT_CHARS = 3000;

/** Save As waits this long for a title before it opens the dialog with the
 *  first line, so a slow service never holds the dialog back for long. */
export const TITLE_TIMEOUT_MS = 3000;

/** Asks the writing model for a title; null when it has none. */
export type SuggestTitle = (excerpt: string) => Promise<string | null>;

/** The part of the document sent to be named. */
export function titleExcerpt(markdown: string): string {
  let excerpt = markdown.trim().slice(0, TITLE_EXCERPT_CHARS);
  // Never end on half of a surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(excerpt)) excerpt = excerpt.slice(0, -1);
  return excerpt;
}

/** Only a document with something written and no level-one heading is
 *  named by the AI: a heading already is its title. */
export function wantsAiTitle(markdown: string): boolean {
  return (
    firstLevelOneHeading(markdown) === null &&
    firstContentLine(markdown) !== null
  );
}

/**
 * The file name Save As proposes: the AI's title when it answers within
 * `timeoutMs`, else `firstLineName` (what it proposes without AI). Never
 * rejects - an error, no answer or a timeout all mean the first line.
 */
export async function aiMarkdownFilename(
  markdown: string,
  firstLineName: string,
  untitled: string,
  suggest: SuggestTitle,
  timeoutMs = TITLE_TIMEOUT_MS,
): Promise<string> {
  if (!wantsAiTitle(markdown)) return firstLineName;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const title = await Promise.race([
      suggest(titleExcerpt(markdown)).catch(() => null),
      timedOut,
    ]);
    return title?.trim() ? markdownFilename(title, untitled) : firstLineName;
  } finally {
    clearTimeout(timer);
  }
}
