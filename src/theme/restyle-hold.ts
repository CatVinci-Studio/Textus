import { onAppearance, RESTYLING } from "../engine/tokens/appearance";
import { CHROME_STYLE_ID } from "../engine/tokens/palette";
import {
  CUSTOM_CSS_STYLE_ID,
  PLUGIN_COLORS_STYLE_ID,
  USER_THEME_STYLE_ID,
} from "./style-ids";

/** What a theme switch changes on the page. Other changes of look (zen,
 *  the keyboard, a stylesheet loading) keep their animations. */
const THEME_MARKS = [
  "data-theme",
  "data-content-theme",
  "data-user-theme",
  "data-light-page",
];
const THEME_STYLES = [
  USER_THEME_STYLE_ID,
  CHROME_STYLE_ID,
  PLUGIN_COLORS_STYLE_ID,
  CUSTOM_CSS_STYLE_ID,
];

function themeNow(): string {
  const root = document.documentElement;
  return [
    ...THEME_MARKS.map((name) => root.getAttribute(name)),
    window.matchMedia?.("(prefers-color-scheme: dark)").matches,
    ...THEME_STYLES.map((id) => document.getElementById(id)?.textContent),
  ].join("\0");
}

/** While the theme changes, transitions are off for two frames (base.css):
 *  every control takes its new colours in the same frame, not each at its
 *  own pace. Returns the function that stops. */
export function holdTransitionsOnThemeChange(): () => void {
  const root = document.documentElement;
  let last = themeNow();
  let hold = 0;
  const stop = onAppearance(() => {
    const now = themeNow();
    if (now === last) return;
    last = now;
    const mine = ++hold;
    root.setAttribute(RESTYLING, "");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (mine === hold) root.removeAttribute(RESTYLING);
      }),
    );
  });
  return () => {
    stop();
    hold++;
    root.removeAttribute(RESTYLING);
  };
}
