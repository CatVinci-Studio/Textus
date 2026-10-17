import { useEffect } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import { themes } from "../platform/ipc";
import { readBoot } from "../storage/boot";
import {
  getUiState,
  setUiState,
  type ThemeChromeCache,
} from "../storage/ui-state";
import type { Settings, ThemeMode } from "../settings/SettingsContext";
import { BUILTIN_CONTENT_THEMES, isMagicDiary } from "./builtin-themes";
import { applyThemeChrome, clearThemeChrome } from "./theme-chrome";
import { adaptTyporaCss } from "./typora-compat";

// Puts the appearance settings on the page: light or dark, the text
// column's width, the content theme (a built-in's attribute, or an imported
// Typora theme's stylesheet and the window colours derived from it) and the
// user's Custom CSS, in that cascade order. SettingsProvider runs it.

/** The <style> holding Settings > Theme > Custom CSS. */
const CUSTOM_CSS_STYLE_ID = "textus-user-css";

/** Keeps an imported theme's chrome colours for the boot script, which
 *  paints the next window's first frame with them (ui-state.ts's
 *  themeChrome) - written only when they changed, so opening a window
 *  doesn't rewrite ui-state.json. Without Rust there is no boot script. */
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
 * Marks every custom property the user's own CSS sets `!important`. An
 * imported theme's chrome (theme-chrome.ts) pins the `--editor-*` colours
 * with !important to beat ui/base.css's dark block, which made a plain
 * `:root { --editor-bg: ... }` in Custom CSS lose. Custom CSS comes after
 * the chrome, so at equal weight it now wins again. Only custom
 * properties: everything else keeps the cascade the user wrote it for.
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

/// Optional-called: an environment without matchMedia (jsdom, an odd
/// webview) must not throw here - `isEffectiveDark` is reachable from
/// render, and inside `loadSettings` a throw would discard the ENTIRE
/// settings blob to answer one question that has a fine default.
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
  // "system" removes the attribute rather than resolving it here, so the
  // @media (prefers-color-scheme) rules in ui/base.css/content-themes.css are
  // what answer - and the app follows an OS switch live, with no listener.
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

  const diary = isMagicDiary(settings);
  // The Magic Diary theme ages the whole window, not just the writing column
  // (magic-diary-page.css) - it is the room that turns out to be a book.
  // An attribute rather than a class so the skin's rules can sit at a
  // specificity that wins against the theme's own without !important, and
  // so one rule can reach the app chrome that no theme variable covers.
  useEffect(() => {
    const root = document.documentElement;
    if (diary) root.setAttribute("data-magic-diary", "");
    else root.removeAttribute("data-magic-diary");
  }, [diary]);

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
    styleEl.textContent = settings.customCss;
    document.head.appendChild(styleEl);
    if (styleEl.sheet) promoteCustomProperties(styleEl.sheet.cssRules);
  }, [settings.customCss]);

  // Resolves the selected theme (built-in content theme, user-imported
  // theme, or "default") to either a `data-content-theme` attribute (for
  // built-ins, which are pure CSS-variable overlays - see
  // content-themes.css) or an injected <style> tag with the theme's raw CSS
  // (for user themes, which are arbitrary Typora-style stylesheets read from
  // disk). Re-resolves on theme/mode change and on live OS dark/light
  // switches while in "system" mode.
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
    // Turns Textus's own content ornaments off (content-base.css): an
    // imported theme should look the way it does in Typora.
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
        const css = await themes.loadThemeCss(theme.id, variant);
        if (cancelled || request !== revision) return;
        let styleEl = document.getElementById(
          STYLE_ID,
        ) as HTMLStyleElement | null;
        if (!styleEl) {
          styleEl = document.createElement("style");
          styleEl.id = STYLE_ID;
        }
        styleEl.textContent = adaptTyporaCss(css ?? "");
        document.head.appendChild(styleEl);
        const dark = isEffectiveDark(settings.theme);
        let chrome: string | null;
        try {
          // A one-design theme is that design's page in both appearances:
          // its chrome is derived as the light page it was written for.
          // Derived as dark, a theme that pins its text dark (most light
          // themes) got a dark page behind it - Pixyll read at 1.3:1 - and
          // one that styles only some boxes kept their light fills under
          // the greyed text.
          chrome = applyThemeChrome(css ?? "", dark && theme.hasDark);
          // ...and the document's own dark-only colours (syntax tokens,
          // alert accents, mermaid) stand down on that light page.
          if (dark && !theme.hasDark) root.setAttribute("data-light-page", "");
          else root.removeAttribute("data-light-page");
        } finally {
          // The user's own CSS stays after the theme and the chrome derived
          // from it, whenever they load - the order the boot script gives
          // the first frame, and the one an edit to it leaves.
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
