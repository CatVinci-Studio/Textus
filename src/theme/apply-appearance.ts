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
} from "../prefs/SettingsContext";
import { BUILTIN_CONTENT_THEMES } from "./builtin-themes";
import { applyThemeChrome, clearThemeChrome } from "./theme-chrome";
import { adaptTyporaCss, namedSystemFonts } from "./typora-compat";
import { isIOSApp } from "../platform/capabilities";
import { withCurrentVariables } from "./legacy-variables";

// Puts the appearance settings on the page: light or dark, the text width,
// the content theme and the user's Custom CSS, in that cascade order.

const CUSTOM_CSS_STYLE_ID = "textus-user-css";

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

function isEffectiveDark(themeMode: ThemeMode): boolean {
  if (themeMode === "dark") return true;
  if (themeMode === "light") return false;
  return systemPrefersDark();
}

export function useApplyAppearance(
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

  useEffect(() => {
    const root = document.documentElement;
    if (settings.contentWidth === "auto")
      root.removeAttribute("data-content-width");
    else root.setAttribute("data-content-width", settings.contentWidth);
  }, [settings.contentWidth]);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.imageAlign === "center")
      root.removeAttribute("data-image-align");
    else root.setAttribute("data-image-align", settings.imageAlign);
  }, [settings.imageAlign]);

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
    styleEl.textContent = withCurrentVariables(settings.customCss);
    document.head.appendChild(styleEl);
    if (styleEl.sheet) promoteCustomProperties(styleEl.sheet.cssRules);
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
        const loaded = await themes.loadThemeCss(theme.id, variant);
        if (cancelled || request !== revision) return;
        const css = loaded && withCurrentVariables(loaded);
        let styleEl = document.getElementById(
          STYLE_ID,
        ) as HTMLStyleElement | null;
        if (!styleEl) {
          styleEl = document.createElement("style");
          styleEl.id = STYLE_ID;
        }
        const adapted = adaptTyporaCss(css ?? "");
        styleEl.textContent = isIOSApp ? namedSystemFonts(adapted) : adapted;
        document.head.appendChild(styleEl);
        const dark = isEffectiveDark(settings.theme);
        let chrome: string | null;
        try {
          // A one-design theme is that design's page in both appearances, its chrome
          // derived as light: derived as dark, themes that pin dark text became unreadable.
          chrome = applyThemeChrome(css ?? "", dark && theme.hasDark);
          // ...and the document's own dark-only colours (syntax tokens,
          // alert accents, mermaid) stand down on that light page.
          if (dark && !theme.hasDark) root.setAttribute("data-light-page", "");
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
            sourceLength: (css ?? "").length,
            css: chrome,
          });
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
