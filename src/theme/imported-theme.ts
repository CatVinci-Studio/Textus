import { themes } from "../platform/ipc";
import { readBoot } from "../storage/boot";
import {
  getUiState,
  setUiState,
  type ThemeChromeCache,
} from "../storage/ui-state";
import type { ThemeMode, UserThemeMeta } from "../prefs/SettingsContext";
import { applyThemeChrome } from "../engine/tokens/palette";
import { isIOSApp } from "../platform/capabilities";
import { lazyModule } from "../lazy/lazy-module";
import {
  CUSTOM_CSS_STYLE_ID,
  PLUGIN_COLORS_STYLE_ID,
  USER_THEME_STYLE_ID as STYLE_ID,
} from "./style-ids";

// What an imported theme or the user's own CSS is read through: loaded
// when there is one, not with every window.
const typora = lazyModule("typora-compat", () => import("./typora-compat"));
export const legacy = lazyModule(
  "legacy-variables",
  () => import("./legacy-variables"),
);
export const webFonts = lazyModule("web-fonts", () => import("./web-fonts"));

type Design = "light" | "dark";

/** A design as stored, and as shown: with its web fonts embedded. */
interface Read {
  stored: string | null;
  css: string | null;
}

/** The active imported theme's designs once read, both of them, so a
 *  switch between light and dark swaps them in the same frame. A new
 *  theme list (one saved over, updated) starts afresh. */
let held: {
  list: readonly UserThemeMeta[];
  id: string;
  designs: Partial<Record<Design, Read>>;
} | null = null;

/// Optional-called: without matchMedia (jsdom, an odd webview) a throw inside
/// `loadSettings` would discard the entire settings blob.
function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function isEffectiveDark(themeMode: ThemeMode): boolean {
  if (themeMode === "dark") return true;
  if (themeMode === "light") return false;
  return systemPrefersDark();
}

/** Keeps an imported theme's chrome colours for the boot script, which
 *  paints the next window's first frame with them. Written only on change. */
function rememberThemeChrome(chrome: ThemeChromeCache) {
  if (!readBoot()) return;
  const cached = getUiState("themeChrome") as
    Partial<ThemeChromeCache> | undefined;
  if (
    cached?.id === chrome.id &&
    cached.dark === chrome.dark &&
    cached.sourceLength === chrome.sourceLength &&
    cached.css === chrome.css
  )
    return;
  setUiState("themeChrome", chrome);
}

/**
 * Marks every custom property the user's CSS sets `!important`, since an
 * imported theme's chrome pins `--doc-*` with !important. Custom CSS comes
 * later, so at equal weight it wins. Other properties keep their cascade.
 */
export function promoteCustomProperties(rules: CSSRuleList) {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      const { style } = rule;
      for (const name of Array.from(style)) {
        if (name.startsWith("--") && !style.getPropertyPriority(name))
          style.setProperty(name, style.getPropertyValue(name), "important");
      }
    }
    if ("cssRules" in rule && rule.cssRules)
      promoteCustomProperties(rule.cssRules as CSSRuleList);
  }
}

/** Puts an imported theme on the page in the appearance `mode` gives, and
 *  again whenever the system's flips. Returns the function that stops. */
export function applyImportedTheme(
  theme: UserThemeMeta,
  mode: ThemeMode,
  list: readonly UserThemeMeta[],
): () => void {
  const root = document.documentElement;
  if (held?.list !== list || held.id !== theme.id)
    held = { list, id: theme.id, designs: {} };
  const { designs } = held;
  let cancelled = false;
  let revision = 0;

  async function read(design: Design): Promise<Read> {
    const [stored, { withWebFonts }] = await Promise.all([
      themes.loadThemeCss(theme.id, design),
      webFonts.load(),
    ]);
    const css = (stored && (await withWebFonts(stored))) || stored;
    designs[design] = { stored, css };
    return { stored, css };
  }

  function show(design: Read) {
    const vars = legacy.peek();
    const compat = typora.peek();
    if (!vars || !compat) return;
    const css = design.css && vars.withCurrentVariables(design.css);
    let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
    }
    const adapted = compat.adaptTyporaCss(css ?? "");
    styleEl.textContent = isIOSApp ? compat.namedSystemFonts(adapted) : adapted;
    document.head.appendChild(styleEl);
    // The built-in theme stands down only now, with this one in: in the
    // wait the page keeps the look it had.
    root.removeAttribute("data-content-theme");
    // Turns Textus's own content ornaments off: an imported theme should
    // look the way it does in Typora.
    root.setAttribute("data-user-theme", "");
    const dark = isEffectiveDark(mode);
    let chrome: string | null;
    try {
      // A one-design theme is that design's page in both appearances, its chrome
      // derived as light: derived as dark, themes that pin dark text became unreadable.
      chrome = applyThemeChrome(css ?? "", dark && theme.hasDark);
      // ...and the document's own dark-only colours (syntax tokens,
      // alert accents, mermaid) stand down on that light page.
      root.toggleAttribute("data-light-page", dark && !theme.hasDark);
    } finally {
      // Plugins' colours after the theme and its chrome...
      const plugin = document.getElementById(PLUGIN_COLORS_STYLE_ID);
      if (plugin) document.head.appendChild(plugin);
      // The user's own CSS stays after the theme and its chrome, whenever they
      // load - the order the boot script gives the first frame.
      const custom = document.getElementById(
        CUSTOM_CSS_STYLE_ID,
      ) as HTMLStyleElement | null;
      if (custom) {
        // Moved, a <style> is parsed again from its text: the
        // promotion has to be redone on the new sheet.
        document.head.appendChild(custom);
        if (custom.sheet) promoteCustomProperties(custom.sheet.cssRules);
      }
    }
    if (typeof chrome === "string")
      rememberThemeChrome({
        id: theme.id,
        dark,
        // The file as stored: what the boot script measures.
        sourceLength: (design.stored ?? "").length,
        css: chrome,
      });
  }

  async function apply() {
    // A single-design import has no dark stylesheet, so it keeps its one
    // look in either appearance rather than being half-applied.
    const design: Design =
      isEffectiveDark(mode) && theme.hasDark ? "dark" : "light";
    const request = ++revision;
    const current = () => !cancelled && request === revision;
    try {
      const ready = designs[design];
      if (ready && legacy.peek() && typora.peek()) return show(ready);
      const [stored] = await Promise.all([
        themes.loadThemeCss(theme.id, design),
        legacy.load(),
        typora.load(),
      ]);
      if (!current()) return;
      show({ stored, css: stored });
      // One imported before web fonts were embedded still has them: the
      // theme shows at once, its fonts once fetched (or not, offline).
      const { withWebFonts } = await webFonts.load();
      const css = (stored && (await withWebFonts(stored))) || stored;
      designs[design] = { stored, css };
      if (css !== stored && current()) show({ stored, css });
      // The other design, so a switch to it needs no wait.
      const other: Design = design === "dark" ? "light" : "dark";
      if (theme.hasDark && !designs[other] && !cancelled) await read(other);
    } catch {
      // Theme file missing/unreadable - leave whatever was there before.
    }
  }

  void apply();

  // Injected CSS can't be swapped by a media query - in "system" mode this
  // is what re-picks the variant when the OS flips.
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  mq?.addEventListener("change", apply);
  return () => {
    cancelled = true;
    mq?.removeEventListener("change", apply);
  };
}
