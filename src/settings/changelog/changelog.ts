import type { Lang } from "../../i18n/strings";

/** One version's notes, as Settings › General › Release Notes lists them. */
export interface ReleaseNote {
  version: string;
  /** YYYY-MM-DD; absent for a version published after this list was made. */
  date?: string;
  /** A beta or release candidate. */
  prerelease: boolean;
  /** The notes as Markdown, without their "What's new" heading. */
  body: string;
}

/** The languages the notes are written in. The rest of the interface
 *  languages read the English. */
export type NotesLanguage = "en" | "zh" | "zh-Hant";

export function notesLanguage(lang: Lang): NotesLanguage {
  return lang === "zh" || lang === "zh-Hant" ? lang : "en";
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** "docs/releases/1.3.0-beta.2.md" -> "1.3.0-beta.2"; null for a file that
 *  isn't a version's (TEMPLATE.md). */
export function versionOfPath(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  return VERSION.test(name) ? name : null;
}

/** Semantic-version order: 1.2.10 after 1.2.9, 1.3.0-beta.8 before 1.3.0. */
export function compareVersions(a: string, b: string): number {
  const pa = VERSION.exec(a);
  const pb = VERSION.exec(b);
  if (!pa || !pb) return a.localeCompare(b);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return d;
  }
  if (!pa[4] || !pb[4]) return (pa[4] ? -1 : 0) - (pb[4] ? -1 : 0);
  return pa[4].localeCompare(pb[4], "en", { numeric: true });
}

// The heading every note opens with, in each language the notes are in.
const LEAD_HEADING = /^##\s+(What's new|更新内容|更新內容)\s*\n+/;
// The release page's last line points at the installers under it, which the
// app has no use for.
const INSTALLERS_LINE = /\n+Installers for [^\n]*the app updates itself\.\s*$/;

export function tidyNotes(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(LEAD_HEADING, "")
    .replace(INSTALLERS_LINE, "")
    .trim();
}

/** Every version's notes, newest first. A later source's file for a
 *  version replaces an earlier one's: a translation over the published
 *  notes. */
export function collectNotes(
  sources: Record<string, string>[],
  dates: Readonly<Record<string, string>>,
): ReleaseNote[] {
  const byVersion = new Map<string, string>();
  for (const source of sources)
    for (const [path, text] of Object.entries(source)) {
      const version = versionOfPath(path);
      if (version) byVersion.set(version, text);
    }
  return [...byVersion]
    .map(([version, text]) => ({
      version,
      date: dates[version],
      prerelease: version.includes("-"),
      body: tidyNotes(text),
    }))
    .filter((note) => note.body)
    .sort((a, b) => compareVersions(b.version, a.version));
}
