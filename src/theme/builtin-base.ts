import baseTokensCss from "../engine/tokens/base.css?raw";
import contentThemesCss from "./content-themes.css?raw";
import frameThemesCss from "./frame-themes.css?raw";
import contentBaseCss from "./content-base.css?raw";
import { cssBlocks, ornamentRules } from "./theme-export";

/** The stylesheets a built-in theme is read from; tests pass them from disk,
 *  since vitest stubs CSS imports. */
export interface BuiltinSources {
  tokens: string;
  themes: string;
  contentBase: string;
}

const SOURCES: BuiltinSources = {
  tokens: baseTokensCss,
  themes: `${contentThemesCss}\n${frameThemesCss}`,
  contentBase: contentBaseCss,
};

/** content-base.css's rules for the document's type, the second for an
 *  engine whose containers can't be measured. */
const TYPE_SELECTORS = [".milkdown", ":root[data-early-containers] .milkdown"];

/** A theme as two stylesheets, as it is saved: light, and dark if it has one. */
export interface ThemeCss {
  light: string;
  dark: string | null;
}

/** The custom properties a list of rules sets, last one winning. */
function properties(
  blocks: ReturnType<typeof cssBlocks>,
  matches: (selector: string) => boolean,
  keep: RegExp,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const { selector, declarations } of blocks) {
    if (!matches(selector)) continue;
    for (const line of declarations) {
      const at = line.indexOf(":");
      const name = line.slice(0, at).trim();
      if (keep.test(name)) out.set(name, line.slice(at + 1).trim());
    }
  }
  return out;
}

function rootBlock(vars: Map<string, string>): string {
  const lines = [...vars].map(([name, value]) => `  ${name}: ${value};`);
  return `:root {\n${lines.join("\n")}\n}`;
}

/** The interface colours an imported theme's chrome is derived from, as
 *  base.css takes them from the document's: written as the colours, so a
 *  later page palette leaves the window as it was. */
const CHROME_INPUTS: [string, string][] = [
  ["--ui-bg", "--doc-bg"],
  ["--ui-text", "--doc-text"],
  ["--ui-accent", "--doc-accent"],
];

function withChromeInputs(vars: Map<string, string>): Map<string, string> {
  for (const [ui, doc] of CHROME_INPUTS) {
    const value = vars.get(doc);
    if (value) vars.set(ui, value);
  }
  return vars;
}

/**
 * A built-in theme restated as an imported one: under `data-user-theme`
 * its palette (the default's, then its own), the document's type and the
 * ornaments no longer come from attributes, so each is written out - a
 * plain `:root` per appearance, saved as two files.
 */
export function builtinThemeCss(
  id: string,
  sources: BuiltinSources = SOURCES,
): ThemeCss {
  const tokens = cssBlocks(sources.tokens);
  const themes = cssBlocks(sources.themes);
  const own = `[data-content-theme="${id}"]`;
  const doc = /^--doc-/;
  const themeVars = /^--(?:doc|ui|tone)-/;
  const light = new Map([
    ...properties(tokens, (s) => s === ":root", doc),
    ...properties(themes, (s) => s === own || s === `:root${own}`, themeVars),
  ]);
  const dark = new Map([
    ...light,
    ...properties(tokens, (s) => s === ':root[data-theme="dark"]', doc),
    ...properties(
      themes,
      (s) => s === `:root[data-theme="dark"]${own}`,
      themeVars,
    ),
  ]);
  // The document's own size, leading and ink: an imported theme's page
  // inherits them from body instead.
  const typeRules = cssBlocks(sources.contentBase)
    .filter((b) => TYPE_SELECTORS.includes(b.selector))
    .map(
      ({ selector, declarations }) =>
        `${selector.replace(".milkdown", "#write")} {\n${declarations
          .map((l) => `  ${l};`)
          .join("\n")}\n}`,
    );
  const rest = [...typeRules, ornamentRules(sources.contentBase)]
    .filter(Boolean)
    .join("\n\n");
  withChromeInputs(light);
  withChromeInputs(dark);
  return {
    light: `${rootBlock(light)}\n\n${rest}\n`,
    dark: `${rootBlock(dark)}\n\n${rest}\n`,
  };
}
