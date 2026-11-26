import type {
  FileIconTheme,
  IconTable,
} from "../../engine/controls/file-icon-theme";

/**
 * A file icon theme's JSON, in VS Code's shape cut to what a listing
 * draws: `iconDefinitions` (an id to `{ iconPath }`, an SVG of the plugin's,
 * relative to the JSON), then `fileNames`, `fileExtensions`, `folderNames`,
 * `folderNamesExpanded`, `file`, `folder`, `folderExpanded`, each naming a
 * definition; `light` holds the same keys, over them in the light
 * appearance. A name with no definition is left out, as VS Code does.
 */

/** More is a mistake, not a theme: each one is read at startup. */
const MOST_ICONS = 2000;

const MAPS = [
  "fileNames",
  "fileExtensions",
  "folderNames",
  "folderNamesExpanded",
] as const;
const DEFAULTS = ["file", "folder", "folderExpanded"] as const;

/** One appearance's names, each to a definition id. */
type Names = Record<(typeof MAPS)[number], Map<string, string>> &
  Partial<Record<(typeof DEFAULTS)[number], string>>;

export interface IconThemeJson {
  /** Definition id → the SVG's path in the plugin. */
  icons: Map<string, string>;
  dark: Names;
  light: Names;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** `rel` from the folder of `from`, inside the plugin; null if it leaves it
 *  or isn't an SVG. */
export function pathBeside(from: string, rel: string): string | null {
  if (!/\.svg$/i.test(rel) || /^([a-z]+:|\/)/i.test(rel)) return null;
  const parts = from.split("/").slice(0, -1);
  for (const part of rel.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

function readNames(o: Record<string, unknown>, base?: Names): Names {
  const names = {} as Names;
  for (const key of MAPS) {
    const map = new Map(base?.[key]);
    const given = o[key];
    if (isObject(given))
      for (const [name, id] of Object.entries(given))
        if (typeof id === "string")
          map.set(
            (key === "fileExtensions"
              ? name.replace(/^\./, "")
              : name
            ).toLowerCase(),
            id,
          );
    names[key] = map;
  }
  for (const key of DEFAULTS) {
    const id = typeof o[key] === "string" ? (o[key] as string) : base?.[key];
    if (id) names[key] = id;
  }
  return names;
}

/** The theme in `json`, read from `themePath` in the plugin; throws when it
 *  isn't one. */
export function parseIconThemeJson(
  json: unknown,
  themePath: string,
): IconThemeJson {
  if (!isObject(json) || !isObject(json.iconDefinitions))
    throw new Error(`${themePath}: no iconDefinitions.`);
  const entries = Object.entries(json.iconDefinitions);
  if (entries.length > MOST_ICONS)
    throw new Error(`${themePath}: more than ${MOST_ICONS} icons.`);
  const icons = new Map<string, string>();
  for (const [id, def] of entries) {
    const rel =
      isObject(def) && typeof def.iconPath === "string"
        ? pathBeside(themePath, def.iconPath)
        : null;
    if (rel) icons.set(id, rel);
  }
  const dark = readNames(json);
  const light = isObject(json.light) ? readNames(json.light, dark) : dark;
  return { icons, dark, light };
}

/** The theme drawn, with each definition's URL; one without a URL (its
 *  file missing) leaves the app's icon there. */
export function iconTheme(
  parsed: IconThemeJson,
  urls: ReadonlyMap<string, string>,
): FileIconTheme {
  const url = (id: string | undefined) => {
    const rel = id === undefined ? undefined : parsed.icons.get(id);
    return rel === undefined ? undefined : urls.get(rel);
  };
  const table = (names: Names): IconTable => {
    const mapped = (key: (typeof MAPS)[number]) =>
      new Map(
        [...names[key]].flatMap(([name, id]) => {
          const u = url(id);
          return u ? [[name, u] as const] : [];
        }),
      );
    return {
      fileNames: mapped("fileNames"),
      fileExtensions: mapped("fileExtensions"),
      folderNames: mapped("folderNames"),
      folderNamesExpanded: mapped("folderNamesExpanded"),
      file: url(names.file),
      folder: url(names.folder),
      folderExpanded: url(names.folderExpanded),
    };
  };
  const dark = table(parsed.dark);
  return {
    dark,
    light: parsed.light === parsed.dark ? dark : table(parsed.light),
  };
}
