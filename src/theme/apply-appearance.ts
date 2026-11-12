import { useEffect } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import { themes } from "../platform/ipc";
import { readBoot } from "../storage/boot";
import {
  getUiState,
  setUiState,
  type ThemeChromeCache,
} from "../storage/ui-state";
import {
  useSettings,
  type Settings,
  type ThemeMode,
  DOC_LINE_HEIGHTS,
  type DocLetterSpacing,
} from "../prefs/SettingsContext";
import { BUILTIN_CONTENT_THEMES } from "../prefs/builtin-themes";
import { applyThemeChrome, clearThemeChrome } from "../engine/tokens/palette";
import { isIOSApp } from "../platform/capabilities";
import { lazyModule } from "../lazy/lazy-module";

// What an imported theme or the user's own CSS is read through: loaded
// when there is one, not with every window.
const typora = lazyModule("typora-compat", () => import("./typora-compat"));
const legacy = lazyModule(
  "legacy-variables",
  () => import("./legacy-variables"),
);
const webFonts = lazyModule("web-fonts", () => import("./web-fonts"));

/** The CSS letter-spacing for Word's character spacing; null keeps the
 *  theme's. */
export function letterSpacing(
  spacing: DocLetterSpacing,
  by: number,
): string | null {
  if (spacing === "auto") return null;
  if (spacing === "normal") return "normal";
  return `${spacing === "condensed" ? -by : by}pt`;
}

// Puts the appearance settings on the page: light or dark, the text width,
// the content theme and the user's Custom CSS, in that cascade order.

const CUSTOM_CSS_STYLE_ID = "textus-user-css";
/** Custom CSS has had its web fonts asked for once (the start). */
let customFontsAsked = false;

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
function promoteCustomProperties(rules: CSSRuleList) {
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

function useApplyAppearance(
  settings: Settings,
  setSettings: (patch: Partial<Settings>) => void,
): void {
  // Called from the theme effect only to fall back from a deleted theme;
  // a ref, so a new function each render doesn't re-run that effect.
  const setSettingsRef = useLatest(setSettings);
  // "system" removes the attribute, so the prefers-color-scheme rules answer
  // and an OS switch is followed live with no listener.
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", settings.theme);
    }
  }, [settings.theme]);

  // The layout on <html> too: its lengths (layout-tokens.css) reach what
  // is drawn outside the window's shell - a lifted island, a menu.
  useEffect(() => {
    document.documentElement.dataset.layout = settings.layout;
  }, [settings.layout]);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.contentWidth === "auto")
      root.removeAttribute("data-content-width");
    else root.setAttribute("data-content-width", settings.contentWidth);
    root.toggleAttribute("data-first-line-indent", settings.firstLineIndent);
  }, [settings.contentWidth, settings.firstLineIndent]);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.imageAlign === "center")
      root.removeAttribute("data-image-align");
    else root.setAttribute("data-image-align", settings.imageAlign);
  }, [settings.imageAlign]);

  // The reader's document size and spacing, over the theme's: set on the
  // root, the attributes let them win over an imported theme too.
  useEffect(() => {
    const root = document.documentElement;
    if (settings.docTextSize === "auto") {
      root.style.removeProperty("--doc-font-size");
      root.removeAttribute("data-doc-size");
    } else {
      root.style.setProperty("--doc-font-size", `${settings.docTextSize}px`);
      root.setAttribute("data-doc-size", "");
    }
    if (settings.docLineSpacing === "auto") {
      root.style.removeProperty("--doc-line-height");
      root.removeAttribute("data-doc-leading");
    } else {
      root.style.setProperty(
        "--doc-line-height",
        String(DOC_LINE_HEIGHTS[settings.docLineSpacing]),
      );
      root.setAttribute("data-doc-leading", "");
    }
    if (settings.docFont) {
      // The theme's stack after it covers what the chosen font lacks.
      root.style.setProperty(
        "--doc-chosen-font",
        `${JSON.stringify(settings.docFont)}, var(--doc-font)`,
      );
      root.setAttribute("data-doc-font", "");
    } else {
      root.style.removeProperty("--doc-chosen-font");
      root.removeAttribute("data-doc-font");
    }
    const tracking = letterSpacing(
      settings.docLetterSpacing,
      settings.docLetterSpacingBy,
    );
    if (tracking === null) {
      root.style.removeProperty("--doc-letter-spacing");
      root.removeAttribute("data-doc-tracking");
    } else {
      root.style.setProperty("--doc-letter-spacing", tracking);
      root.setAttribute("data-doc-tracking", "");
    }
  }, [
    settings.docTextSize,
    settings.docLineSpacing,
    settings.docFont,
    settings.docLetterSpacing,
    settings.docLetterSpacingBy,
  ]);

  // A factor on font sizes rather than CSS zoom on the panels: WebKit's zoom
  // leaves popovers and pointer coordinates in the unzoomed space.
  useEffect(() => {
    const root = document.documentElement;
    if (settings.uiTextScale === 1)
      root.style.removeProperty("--ui-text-scale");
    else
      root.style.setProperty("--ui-text-scale", String(settings.uiTextScale));
  }, [settings.uiTextScale]);

  useEffect(() => {
    let styleEl = document.getElementById(
      CUSTOM_CSS_STYLE_ID,
    ) as HTMLStyleElement | null;
    if (!settings.customCss.trim()) {
      styleEl?.remove();
      return;
    }
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = CUSTOM_CSS_STYLE_ID;
    }
    const style = styleEl;
    let current = true;
    const show = async (css: string) => {
      const { withCurrentVariables } = await legacy.load();
      if (!current) return;
      style.textContent = withCurrentVariables(css);
      if (style.sheet) promoteCustomProperties(style.sheet.cssRules);
    };
    // In the document first: a <style> has a sheet to promote only there.
    document.head.appendChild(style);
    void show(settings.customCss);
    // Its web fonts come a moment later, fetched by Rust, once typing
    // pauses: not for every partial address. At start, at once.
    const delay = customFontsAsked ? 400 : 0;
    customFontsAsked = true;
    const fetchFonts = window.setTimeout(() => {
      void webFonts.load().then(async ({ withWebFonts }) => {
        const css = await withWebFonts(settings.customCss);
        if (current && css !== settings.customCss) void show(css);
      });
    }, delay);
    return () => {
      current = false;
      window.clearTimeout(fetchFonts);
    };
  }, [settings.customCss]);

  // Built-in themes are CSS-variable overlays set by attribute; imported
  // themes are arbitrary stylesheets injected as a <style>. Re-resolves on
  // theme/mode change and on OS switches in "system" mode.
  useEffect(() => {
    const root = document.documentElement;
    const STYLE_ID = "textus-custom-theme";

    function clearInjectedStyle() {
      document.getElementById(STYLE_ID)?.remove();
      root.removeAttribute("data-user-theme");
      root.removeAttribute("data-light-page");
      clearThemeChrome();
    }

    const builtin = BUILTIN_CONTENT_THEMES.find(
      (t) => t.id === settings.themeId,
    );
    if (builtin) {
      if (builtin.id === "default") root.removeAttribute("data-content-theme");
      else root.setAttribute("data-content-theme", builtin.id);
      clearInjectedStyle();
      return;
    }

    const userTheme = settings.userThemes.find(
      (t) => t.id === settings.themeId,
    );
    if (!userTheme) {
      // Unknown or deleted theme (e.g. loaded from a stale settings blob) -
      // fall back to default rather than silently doing nothing.
      root.removeAttribute("data-content-theme");
      clearInjectedStyle();
      if (settings.themeId !== "default")
        setSettingsRef.current({ themeId: "default" });
      return;
    }

    root.removeAttribute("data-content-theme");
    // Turns Textus's own content ornaments off: an imported theme should look
    // the way it does in Typora.
    root.setAttribute("data-user-theme", "");
    let cancelled = false;
    let revision = 0;
    const theme = userTheme;

    async function applyUserTheme() {
      // A single-design import has no dark stylesheet, so it keeps its one
      // look in either appearance rather than being half-applied.
      const request = ++revision;
      const variant =
        isEffectiveDark(settings.theme) && theme.hasDark ? "dark" : "light";
      try {
        const [stored, { withWebFonts }, { withCurrentVariables }, compat] =
          await Promise.all([
            themes.loadThemeCss(theme.id, variant),
            webFonts.load(),
            legacy.load(),
            typora.load(),
          ]);
        const current = () => !cancelled && request === revision;
        const show = (loaded: string | null) => {
          const css = loaded && withCurrentVariables(loaded);
          let styleEl = document.getElementById(
            STYLE_ID,
          ) as HTMLStyleElement | null;
          if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = STYLE_ID;
          }
          const adapted = compat.adaptTyporaCss(css ?? "");
          styleEl.textContent = isIOSApp
            ? compat.namedSystemFonts(adapted)
            : adapted;
          document.head.appendChild(styleEl);
          const dark = isEffectiveDark(settings.theme);
          let chrome: string | null;
          try {
            // A one-design theme is that design's page in both appearances, its chrome
            // derived as light: derived as dark, themes that pin dark text became unreadable.
            chrome = applyThemeChrome(css ?? "", dark && theme.hasDark);
            // ...and the document's own dark-only colours (syntax tokens,
            // alert accents, mermaid) stand down on that light page.
            if (dark && !theme.hasDark)
              root.setAttribute("data-light-page", "");
            else root.removeAttribute("data-light-page");
          } finally {
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
              sourceLength: (stored ?? "").length,
              css: chrome,
            });
        };
        if (!current()) return;
        show(stored);
        // One imported before web fonts were embedded still has them: the
        // theme shows at once, its fonts once fetched (or not, offline).
        const fonted = stored && (await withWebFonts(stored));
        if (fonted && fonted !== stored && current()) show(fonted);
      } catch {
        // Theme file missing/unreadable - leave whatever was there before.
      }
    }

    void applyUserTheme();

    // Injected CSS can't be swapped by a media query - in "system" mode this
    // is what re-picks the variant when the OS flips.
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener("change", applyUserTheme);
    return () => {
      cancelled = true;
      mq?.removeEventListener("change", applyUserTheme);
    };
  }, [settings.themeId, settings.theme, settings.userThemes, setSettingsRef]);
}

/** Applies the settings' look to the window: rendered once, inside the
 *  settings provider. */
export function AppearanceSync(): null {
  const { settings, setSettings } = useSettings();
  useApplyAppearance(settings, setSettings);
  return null;
}
