/** What a download adds to, where it goes, and the totals the catalogs
 *  read. No request is kept: only these counts. */

const GITHUB = {
  plugins: "https://github.com/CatVinci-Studio/textus-plugins/releases/download/",
  themes:
    "https://raw.githubusercontent.com/CatVinci-Studio/textus-themes/main/themes/",
};
/** Textus's own site, which passes the same files on (via=site; older
 *  versions of the app go to GitHub). */
const SITE = {
  plugins: "https://textus.catvinci.com/plugin-release/",
  themes: "https://textus.catvinci.com/theme-gallery/themes/",
};

const KINDS = ["plugin", "theme", "skill"] as const;
const EVENTS = ["install", "reinstall", "update"] as const;

type Kind = (typeof KINDS)[number];

// The catalogs' own rules: a plugin id is publisher.name, a theme or skill
// id a lowercase-hyphen name; a plugin's version names its release.
const PLUGIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
// A theme's version is its `updated` time.
const VERSION = /^[0-9A-Za-z.:+-]{1,40}$/;
const CSS_FILE = /^[A-Za-z0-9_-]{1,64}\.css$/;

export interface Count {
  kind: Kind;
  id: string;
  version: string;
  event: string;
}

export const COUNT_FIELDS = [
  "kind",
  "id",
  "version",
  "event",
] as const satisfies readonly (keyof Count)[];

/** Adds one to a day's total: ?1 the day, then COUNT_FIELDS. */
export const ADD_SQL = `INSERT INTO daily (day, kind, id, version, event, count)
  VALUES (?1, ?2, ?3, ?4, ?5, 1)
  ON CONFLICT (day, kind, id, version, event)
  DO UPDATE SET count = count + 1`;

/** Every total as a Row, `recent` from day ?1 on. */
export const TOTALS_SQL = `SELECT kind, id, version, event, SUM(count) AS total,
    SUM(CASE WHEN day >= ?1 THEN count ELSE 0 END) AS recent
  FROM daily GROUP BY kind, id, version, event`;

type Fields = Record<string, unknown>;

const text = (fields: Fields, key: string) =>
  typeof fields[key] === "string" ? (fields[key] as string) : "";

const oneOf = <T extends string>(list: readonly T[], value: string) =>
  (list as readonly string[]).includes(value) ? (value as T) : null;

function validId(kind: Kind, id: string): boolean {
  return id.length <= 80 && (kind === "plugin" ? PLUGIN_ID : NAME).test(id);
}

/** The package a download asks for, built only from the patterns its
 *  catalog uses, so nothing else can be redirected to. */
export function packageUrl(fields: Fields): string | null {
  const kind = oneOf(KINDS, text(fields, "kind"));
  const id = text(fields, "id");
  const version = text(fields, "version");
  if (!kind || !validId(kind, id)) return null;
  const base = text(fields, "via") === "site" ? SITE : GITHUB;
  if (kind === "plugin")
    return SEMVER.test(version)
      ? `${base.plugins}${id}-v${version}/${id}-${version}.zip`
      : null;
  if (kind === "skill") return `${base.plugins}catalog/skill-${id}.md`;
  const file = text(fields, "file") || "theme.css";
  return CSS_FILE.test(file) ? `${base.themes}${id}/${file}` : null;
}

/** The download `fields` count as, or null for a malformed one. */
export function readCount(fields: Fields): Count | null {
  const kind = oneOf(KINDS, text(fields, "kind"));
  const id = text(fields, "id");
  const version = text(fields, "version");
  const event = oneOf(EVENTS, text(fields, "event"));
  if (!kind || !validId(kind, id) || !VERSION.test(version) || !event)
    return null;
  return { kind, id, version, event };
}

/** Only the app counts: it names itself in its User-Agent, a crawler
 *  following a link doesn't. */
export function fromApp(userAgent: string | null): boolean {
  return /^Textus(?:\/|$)/.test(userAgent ?? "");
}

/** One summed row of the daily table. */
export interface Row {
  kind: string;
  id: string;
  version: string;
  event: string;
  total: number;
  /** Over the last 30 days. */
  recent: number;
}

export interface ExtensionStats {
  /** First installs, ever (not reinstalls or updates). */
  installs: number;
  installs30: number;
  updates30: number;
  /** The last 30 days' updates, by the version updated to. */
  updates30ByVersion: Record<string, number>;
}

export type Stats = Record<Kind, Record<string, ExtensionStats>>;

export function summarize(rows: Row[]): Stats {
  const out: Stats = { plugin: {}, theme: {}, skill: {} };
  for (const row of rows) {
    const kind = oneOf(KINDS, row.kind);
    if (!kind) continue;
    const s = (out[kind][row.id] ??= {
      installs: 0,
      installs30: 0,
      updates30: 0,
      updates30ByVersion: {},
    });
    if (row.event === "install") {
      s.installs += row.total;
      s.installs30 += row.recent;
    } else if (row.event === "update" && row.recent > 0) {
      s.updates30 += row.recent;
      s.updates30ByVersion[row.version] =
        (s.updates30ByVersion[row.version] ?? 0) + row.recent;
    }
  }
  return out;
}

/** The UTC day `days` before `now`, YYYY-MM-DD. */
export function dayOf(now: Date, days = 0): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}
