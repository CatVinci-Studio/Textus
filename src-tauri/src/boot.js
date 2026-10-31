/* global window, document, MutationObserver */
// Runs in every app webview before the page's own scripts (settings.rs's
// boot_script appends the call with the snapshot). Two jobs:
//
// 1. Publish the snapshot as `window.__BOOT__`, which the frontend reads
//    synchronously (src/storage/boot.ts) instead of localStorage.
// 2. Put the appearance settings on the document NOW, so the first frame is
//    already in the right theme. React applies the same things again once
//    it mounts (SettingsContext.tsx) - the element ids and attributes here
//    must stay the ones it uses, so it takes these over instead of adding
//    second copies.
//
// Plain JavaScript with no imports: it is injected as a string.
window.__textusBoot = function (boot, themeCss) {
  delete window.__textusBoot;
  window.__BOOT__ = boot;
  var settings = boot.settings || {};

  function apply(root) {
    // Same mapping as localeOf() in src/i18n/langs.ts: a code of LANGS,
    // with Chinese given the region that picks its glyphs.
    var lang = {
      en: "en",
      zh: "zh-CN",
      "zh-Hant": "zh-TW",
      ja: "ja",
      ko: "ko",
      es: "es",
      fr: "fr",
      de: "de",
      ru: "ru",
      pt: "pt",
    }[settings.language];
    if (lang) root.setAttribute("lang", lang);
    if (settings.theme === "light" || settings.theme === "dark")
      root.setAttribute("data-theme", settings.theme);
    if (
      settings.contentWidth === "standard" ||
      settings.contentWidth === "full"
    )
      root.setAttribute("data-content-width", settings.contentWidth);
    // UI_TEXT_SCALES in SettingsContext.tsx, minus 1 (the stylesheet's own
    // default); theme/apply-appearance.ts sets the same property.
    if ([0.9, 1.1, 1.25].indexOf(settings.uiTextScale) >= 0)
      root.style.setProperty("--ui-text-scale", String(settings.uiTextScale));
    // BUILTIN_CONTENT_THEMES in SettingsContext.tsx, minus "default" (which
    // is the absence of the attribute).
    var builtin = ["paper", "slate", "forest", "parchment"];
    if (builtin.indexOf(settings.themeId) >= 0)
      root.setAttribute("data-content-theme", settings.themeId);
    else if (themeCss) root.setAttribute("data-user-theme", "");
    // macOS only (native_titlebar_height in lib.rs): what the window bar
    // lines its contents up with, so they sit level with the traffic lights.
    if (typeof boot.titlebarHeight === "number")
      root.style.setProperty(
        "--native-titlebar-height",
        boot.titlebarHeight + "px",
      );
  }

  function promote(rules) {
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      var style = rule.style;
      if (style)
        for (var j = 0; j < style.length; j++) {
          var name = style[j];
          if (name.indexOf("--") === 0 && !style.getPropertyPriority(name))
            style.setProperty(name, style.getPropertyValue(name), "important");
        }
      if (rule.cssRules) promote(rule.cssRules);
    }
  }

  function addStyle(id, css) {
    var style = document.createElement("style");
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // isEffectiveDark() in SettingsContext.tsx.
  function effectiveDark() {
    return (
      settings.theme === "dark" ||
      (settings.theme !== "light" &&
        !!window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches)
    );
  }

  // Stylesheets go at the END of <head>, after the app's own CSS, where
  // React keeps them too: custom CSS has to win ties with the theme, and
  // both with App.css. So they wait for <body> to start, which means <head>
  // (and its stylesheet links) has been parsed - and nothing is painted
  // before there's a body to paint.
  function addStyles() {
    if (themeCss) {
      var dark = effectiveDark();
      var source = dark && themeCss.dark ? themeCss.dark : themeCss.light;
      // A one-design theme keeps its light page in the dark appearance
      // (applyUserTheme() in SettingsContext.tsx).
      if (dark && !themeCss.dark)
        document.documentElement.setAttribute("data-light-page", "");
      // adaptTyporaCss() in src/theme/typora-compat.ts.
      var css = source.replace(
        /\bthead\b(?:\s*>?\s*tr\b)?/g,
        "tr[data-is-header]",
      );
      // namedSystemFonts() in src/theme/typora-compat.ts, on iOS.
      var ios =
        /^(iPhone|iPad|iPod)/.test(navigator.platform) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (ios) {
        var faces = {
          "-apple-system": '"SF Pro Text"',
          "system-ui": '"SF Pro Text"',
          "ui-sans-serif": '"SF Pro Text"',
          "ui-serif": '"New York"',
          "ui-monospace": '"SF Mono"',
          "ui-rounded": '"SF Pro Rounded"',
        };
        css = css.replace(
          /(?<=[\s,:])(-apple-system|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded)(?=\s*[,;}!]|\s*$)/gm,
          function (name) {
            return faces[name];
          },
        );
      }
      addStyle("textus-custom-theme", css);
      // The app's own colours (sidebar, background, accents) as the
      // frontend last derived them from this stylesheet in this appearance
      // - applyThemeChrome() in src/theme/theme-chrome.ts, which needs a
      // CSS engine to work them out, so they're remembered in ui-state.json
      // (ThemeChromeCache in src/storage/ui-state.ts) rather than computed
      // here. Anything else: none, and the frontend applies them a moment
      // later as before.
      var chrome = (boot.uiState || {}).themeChrome;
      if (
        chrome &&
        chrome.id === settings.themeId &&
        chrome.dark === dark &&
        chrome.sourceLength === source.length &&
        typeof chrome.css === "string"
      )
        addStyle("textus-imported-chrome", chrome.css);
    }
    if (settings.customCss && String(settings.customCss).trim()) {
      addStyle("textus-user-css", String(settings.customCss));
      // promoteCustomProperties() in SettingsContext.tsx: the user's `--*`
      // beat the imported chrome's !important ones.
      var userSheet = document.getElementById("textus-user-css").sheet;
      if (userSheet) promote(userSheet.cssRules);
    }
  }

  try {
    // The document element can still be missing this early on some engines;
    // then the observer below applies the attributes as soon as it exists.
    var root = document.documentElement;
    if (root) apply(root);
    var styles =
      !!themeCss || !!(settings.customCss && String(settings.customCss).trim());
    if (root && !styles) return;
    if (styles && document.body) return addStyles();
    var observer = new MutationObserver(function () {
      if (!root && document.documentElement) {
        root = document.documentElement;
        apply(root);
      }
      if (root && (!styles || document.body)) {
        observer.disconnect();
        if (styles) addStyles();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  } catch {
    // A first-paint nicety only; the frontend applies everything anyway.
  }
};
