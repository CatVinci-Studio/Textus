import type { Lang } from "../../i18n/strings";
import { systemIpc } from "../../platform/ipc";
import { getUiState, setUiState } from "../../storage/ui-state";
import { quickPickMatches } from "../../ui/quick-pick";
import type { FontFamily } from "../../platform/bindings/app";

export type { FontFamily };

let families: Promise<FontFamily[]> | null = null;
/** Read once per session: the list is a few hundred names and rarely
 *  changes while Textus runs. */
export function fontFamilies(): Promise<FontFamily[]> {
  // Without the native side (the browser build) there is no list.
  families ??= systemIpc
    .fontFamilies()
    .then((list) => (Array.isArray(list) ? list : []))
    .catch(() => []);
  return families;
}

/** The two scripts of Chinese stand in for each other: a font named only
 *  in one is still better read in it than in English. */
const NEAR: Partial<Record<Lang, Lang>> = { zh: "zh-Hant", "zh-Hant": "zh" };

/** What the family is called in the UI's language, its CSS name if the
 *  font carries none. */
export function fontLabel(family: FontFamily, lang: Lang): string {
  const near = NEAR[lang];
  return family.local[lang] ?? (near && family.local[near]) ?? family.name;
}

/** The families whose names - any of them - hold every word typed, or
 *  whose Chinese name the query spells in pinyin. */
export function matchFonts(
  list: FontFamily[],
  query: string,
  lang: Lang,
): FontFamily[] {
  if (!query.trim()) return list;
  return list.filter((family) =>
    quickPickMatches(
      {
        label: fontLabel(family, lang),
        description: [family.name, ...Object.values(family.local)].join(" "),
      },
      query,
    ),
  );
}

const RECENT_LIMIT = 5;

/** The fonts last chosen, newest first. */
export function recentFonts(): string[] {
  const value = getUiState("recentFonts");
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

export function rememberFont(name: string): void {
  setUiState(
    "recentFonts",
    [name, ...recentFonts().filter((n) => n !== name)].slice(0, RECENT_LIMIT),
  );
}

/** The picker's first group: the fonts chosen lately that this machine has,
 *  and the chosen font if it lacks it (set on another machine). */
export function recentGroup(
  list: FontFamily[],
  recent: string[],
  current: string,
): FontFamily[] {
  const byName = new Map(list.map((family) => [family.name, family]));
  const names = recent.filter((name) => byName.has(name));
  if (current && !byName.has(current)) names.unshift(current);
  return names.map((name) => byName.get(name) ?? { name, local: {} });
}
