import { androidBridge } from "../platform/android-bridge";
import { nativeFiles } from "../platform/native-files";
import { useEffect, useLayoutEffect } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import { windowBarIpc } from "../platform/ipc";
import {
  useSettings,
  type Settings,
  DOC_LINE_HEIGHTS,
  type DocLetterSpacing,
} from "../prefs/SettingsContext";
import { BUILTIN_CONTENT_THEMES } from "../prefs/builtin-themes";
import { UI_SIZE_NAMES, UI_TEXT_SCALES } from "../prefs/settings-values";
import { clearThemeChrome } from "../engine/tokens/palette";
import { isIOSApp } from "../platform/capabilities";
import { lazyModule } from "../lazy/lazy-module";
import { holdTransitionsOnThemeChange } from "./restyle-hold";
import { tokenPx } from "../engine/tokens/token-px";
import { useFileIconThemeChoice } from "../plugins/contributions/file-icon-themes";
import {
  CUSTOM_CSS_STYLE_ID,
  USER_THEME_STYLE_ID as STYLE_ID,
} from "./style-ids";
import {
  applyImportedTheme,
  legacy,
  promoteCustomProperties,
  webFonts,
} from "./imported-theme";

const suppliedFont = lazyModule(
  "supplied-font",
  () => import("./supplied-font"),
);

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

/** Custom CSS has had its web fonts asked for once (the start). */
let customFontsAsked = false;

/** Tells macOS the size's bar height, which its traffic lights centre on.
 *  The token is a calc(), so it is read resolved; nothing is sent before
 *  the page has laid it out. */
export function followWindowBar(): void {
  const height = tokenPx("--window-bar-height", { fresh: true });
  if (height > 0) void windowBarIpc.follow(height);
}

/** The page's layout, width, picture alignment and the reader's type,
 *  set on <html>. */
function usePageAttributes(settings: Settings): void {
  // The layout on <html> too: its lengths (layout-tokens.css) reach what
  // is drawn outside the window's shell - a lifted island, a menu. Before
  // the first paint: without it the frame's edges and gaps are unset.
  useLayoutEffect(() => {
    document.documentElement.dataset.layout = settings.layout;
  }, [settings.layout]);

  useLayoutEffect(() => {
    document.documentElement.toggleAttribute(
      "data-plain-frame",
      settings.plainFrame,
    );
  }, [settings.plainFrame]);

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
    if (settings.docFont || suppliedFont.peek())
      void suppliedFont.load().then((m) => m.supplyFont(settings.docFont));
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
    // Android's bar icons go light on a dark page (MainActivity).
    androidBridge()?.setAppearance(settings.theme);
    // iOS's keyboard takes the window's dark or light.
    if (isIOSApp) nativeFiles.appearance(settings.theme);
  }, [settings.theme]);

  usePageAttributes(settings);

  // A factor on font sizes rather than CSS zoom on the panels: WebKit's zoom
  // leaves popovers and pointer coordinates in the unzoomed space.
  useEffect(() => {
    const root = document.documentElement;
    const size = UI_SIZE_NAMES[UI_TEXT_SCALES.indexOf(settings.uiTextScale)];
    if (!size || size === "medium") {
      root.style.removeProperty("--ui-text-scale");
      delete root.dataset.uiSize;
    } else {
      root.style.setProperty("--ui-text-scale", String(settings.uiTextScale));
      root.dataset.uiSize = size;
    }
    if (root.dataset.windowChrome === "native") followWindowBar();
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

    function clearInjectedStyle() {
      document.getElementById(STYLE_ID)?.remove();
      root.removeAttribute("data-user-theme");
      root.removeAttribute("data-light-page");
      clearThemeChrome();
    }

    // Which theme, for plugins that keep colours per theme.
    root.dataset.themeId = settings.themeId;
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

    return applyImportedTheme(userTheme, settings.theme, settings.userThemes);
  }, [settings.themeId, settings.theme, settings.userThemes, setSettingsRef]);
}

/** Applies the settings' look to the window: rendered once, inside the
 *  settings provider. */
export function AppearanceSync(): null {
  const { settings, setSettings } = useSettings();
  useApplyAppearance(settings, setSettings);
  useEffect(() => holdTransitionsOnThemeChange(), []);
  useFileIconThemeChoice(settings.fileIconTheme);
  return null;
}
