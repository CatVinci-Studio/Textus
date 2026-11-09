import type { LibraryEntry } from "../../../platform/ipc";
import { localeOf, type Lang } from "../../../i18n/strings";
import { basename } from "../../../utils/path";

/** The Memory page's text: dates, ids, search and the lines a rule or a style reads as. */

/** "Oct 18, 2026" from the record's `2026-10-18T09:30:00Z`, in the UI's
 *  language; "" when there is none. */
export function rememberedDate(stamp: string, lang: Lang): string {
  const date = new Date(stamp);
  if (!stamp || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(localeOf(lang), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** A library entry's id for the memory commands: its file
 *  `.textus/library/<stem>.md` as `project/library/<stem>`. */
export function libraryEntryId(entry: LibraryEntry): string {
  return `project/library/${basename(entry.file).replace(/\.md$/, "")}`;
}

/** How many forgotten things the tab lists (the folder keeps 30). */
export const FORGOTTEN_SHOWN = 10;

/** From this many memories and library entries on, the tab has a search. */
export const SEARCH_FROM = 6;

/** Whether any of `texts` contains `query`, case aside; everything matches
 *  an empty query. */
export function matches(query: string, ...texts: string[]): boolean {
  const q = query.trim().toLocaleLowerCase();
  return !q || texts.some((text) => text.toLocaleLowerCase().includes(q));
}

/** The style profile's points, for a glance: its list items and plain
 *  lines, without the front matter, headings or comments. */
export function styleSummary(style: string | null): string[] {
  if (!style) return [];
  const body = style.replace(/^---\n[\s\S]*?\n---\n?/, "");
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.replace(/^[-*+]\s+|^\d+[.)]\s+/, ""))
    .filter(Boolean)
    .slice(0, 6);
}

export function ruleLines(text: string): string[] {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.replace(/^[-*+]\s+|^\d+[.)]\s+/, ""))
    .slice(0, 8);
}

export function firstLine(body: string): string {
  return (
    body
      .replace(/^---\n[\s\S]*?\n---\n?/, "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#")) ?? ""
  );
}

/** A file's name without its folder or extension - its id's last part. */
export function stemOf(path: string): string {
  return (path.split(/[\\/]/).pop() ?? "").replace(/\.[^.]*$/, "");
}

/** From this share of the memory budget on, the tab says how much is used. */
export const NEAR_CAP = 0.8;
