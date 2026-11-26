import { APP_NAME } from "../i18n/names";
import type { ThemeCss } from "./builtin-base";
import {
  PAGE_PALETTES,
  paletteVariables,
  SYNTAX_PALETTES,
} from "./workshop-palettes";
import {
  NO_CHOICES,
  rule,
  TYPE_RANGES,
  typographyCss,
  type FontStacks,
  type TypeChoices,
  type TypeFont,
  type TypeMeasure,
} from "./theme-typography";

/** The comment that parts a workshop theme: its starting theme above, the
 *  workshop's rules and the choices that made them below. Plain CSS, so it
 *  goes through export and import as it is. */
const MARK = `/* ${APP_NAME} workshop: `;
const MARK_RE = new RegExp(
  `\\n*${MARK.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(\\{.*\\}) \\*/\\n`,
);
const HEAD_RE = /^\/\* .* - made in the .* theme workshop \*\/\n+/;

/** The window's colours a theme implies (palette.ts's chrome), pinned as
 *  they are: a page palette recolours the document, never the window. */
export interface ChromePins {
  light: string | null;
  dark: string | null;
}

/** A chrome stylesheet's interface declarations, as a theme's own. */
export function chromeDeclarations(chrome: string): string[] {
  return [...chrome.matchAll(/(--[a-z-]+):\s*([^;]+?)\s*(?:!important)?;/g)]
    .filter(([, name]) => !/^--(?:doc|theme)-/.test(name))
    .map(([, name, value]) => `${name}: ${value}`);
}

export interface WorkshopTheme {
  name: string;
  base: ThemeCss;
  choices: TypeChoices;
}

/**
 * The theme to install: each of the starting theme's files, then the mark
 * with the choices, then the workshop's rules for that appearance - the
 * faces served from files, the typography, the palettes' variables and, with a page palette, the window's
 * colours held at the starting theme's.
 */
export function workshopThemeCss(
  { name, base, choices }: WorkshopTheme,
  stacks?: FontStacks,
  chrome: ChromePins = { light: null, dark: null },
  faces = "",
): ThemeCss {
  const head = `/* ${name.replace(/\*\//g, "")} - made in the ${APP_NAME} theme workshop */`;
  const type = typographyCss(choices, stacks);
  const saved = JSON.stringify(choices).replace(/\*\//g, "* /");
  const join = (css: string, dark: boolean) => {
    const pins = choices.palette ? (dark ? chrome.dark : chrome.light) : null;
    const colours = rule(":root", [
      ...paletteVariables(choices.palette, choices.syntax, dark).map(
        ([k, v]) => `${k}: ${v}`,
      ),
      ...(pins ? chromeDeclarations(pins) : []),
    ]);
    return (
      [head, css.trim(), `${MARK}${saved} */`, faces, type, colours]
        .filter(Boolean)
        .join("\n\n") + "\n"
    );
  };
  return {
    light: join(base.light, false),
    dark: base.dark ? join(base.dark, true) : null,
  };
}

const FONTS: TypeFont[] = ["bodyFont", "headingFont", "codeFont"];
const PALETTES = { palette: PAGE_PALETTES, syntax: SYNTAX_PALETTES };

/** Saved choices as the workshop can use them: a file edited by hand may
 *  hold anything, and what doesn't fit is the theme's own. */
function savedChoices(raw: unknown): TypeChoices {
  const saved = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const choices = { ...NO_CHOICES };
  for (const key of FONTS) {
    const font = saved[key];
    if (typeof font === "string") choices[key] = font.trim();
  }
  for (const key of Object.keys(TYPE_RANGES) as TypeMeasure[]) {
    const n = saved[key];
    const { min, max } = TYPE_RANGES[key];
    if (typeof n === "number" && Number.isFinite(n))
      choices[key] = Math.min(max, Math.max(min, n));
  }
  for (const key of ["palette", "syntax"] as const) {
    const id = saved[key];
    if (PALETTES[key].some((p) => p.id === id)) choices[key] = id as string;
  }
  return choices;
}

/** A workshop theme read back: its starting theme and choices; null for any
 *  other theme. */
export function readWorkshopTheme(
  css: ThemeCss,
  name: string,
): WorkshopTheme | null {
  const part = (file: string) => {
    const match = MARK_RE.exec(file);
    if (!match) return null;
    try {
      const choices = savedChoices(JSON.parse(match[1]));
      const base = file.slice(0, match.index).replace(HEAD_RE, "") + "\n";
      return { base, choices };
    } catch {
      return null;
    }
  };
  const light = part(css.light);
  if (!light) return null;
  const dark = css.dark ? part(css.dark) : null;
  return {
    name,
    choices: light.choices,
    base: { light: light.base, dark: dark?.base ?? null },
  };
}
